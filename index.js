const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });
const connectDB = require("./src/config/db");
const Bid = require("./src/models/BidSchema");
const cors = require("cors");
const mongoose = require("mongoose");
const User = require("./src/models/userSchema");
const Order = require("./src/models/OrderSchema");
const Weather = require("./src/models/WeatherSchema"); // Add this import
const SocketService = require("./src/services/socketService");

const app = express();
const server = http.createServer(app);

// Initialize Socket.IO
const io = new Server(server, {
  cors: {
    origin: "http://localhost:3000", // Your Next.js frontend URL
    methods: ["GET", "POST"],
  },
});

// Initialize Socket Service
const socketService = new SocketService(io);

const PORT = process.env.PORT || 5500;

app.use(cors());
app.use(express.json());

// Make io and socketService available to routes
app.set("io", io);
app.set("socketService", socketService);

// Routes to get Bids data
app.get("/api/get/bids", async (req, res) => {
  try {
    const bids = await Bid.find().limit(20);
    res.status(200).json({ bids });
  } catch (error) {
    console.error("Error fetching bids:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Update the existing bid fetch endpoint to include dynamic pricing
app.get("/api/get/bid/:bidid", async (req, res) => {
  try {
    const { bidid } = req.params;
    const bid = await Bid.findById(bidid);

    if (!bid) {
      return res.status(404).json({ error: "Bid not found" });
    }

    // Calculate current dynamic pricing
    const orders = await Order.find({
      bidId: bidid,
      status: { $in: ["pending", "partly_filled"] },
    });

    // Group orders by option and price, considering remaining quantities
    const priceGroups = {};
    orders.forEach((order) => {
      const remainingQuantity = order.quantity - (order.filledQuantity || 0);
      if (remainingQuantity <= 0) return;

      const key = `${order.optionKey}_${order.price}`;
      if (!priceGroups[key]) {
        priceGroups[key] = {
          price: order.price,
          quantity: 0,
          option: order.optionKey,
        };
      }
      priceGroups[key].quantity += remainingQuantity;
    });

    // Find the price with maximum pending orders
    let maxQuantity = 0;
    let dominantPrice = null;
    let dominantOption = null;

    Object.values(priceGroups).forEach((group) => {
      if (group.quantity > maxQuantity) {
        maxQuantity = group.quantity;
        dominantPrice = group.price;
        dominantOption = group.option;
      }
    });

    // Calculate dynamic pricing
    let currentYesPrice = bid.yesPrice; // Default to stored price

    if (dominantPrice !== null && dominantOption) {
      if (dominantOption === "Yes") {
        currentYesPrice = dominantPrice;
      } else {
        currentYesPrice = 10 - dominantPrice;
      }
    }

    // Return bid data with current dynamic pricing
    const bidData = {
      ...bid.toObject(),
      yesPrice: currentYesPrice,
      dynamicPricing: {
        isDynamic: dominantPrice !== null,
        dominantOption,
        dominantPrice,
        maxQuantity,
      },
    };

    res.status(200).json({ bid: bidData });
  } catch (error) {
    console.error("Error fetching bid:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Updated helper function to find matching orders - INCLUDE partly_filled orders
const findMatchingOrders = async (newOrder) => {
  const complementaryPrice = 10 - newOrder.price;
  const oppositeOption = newOrder.optionKey === "Yes" ? "No" : "Yes";

  const matchingOrders = await Order.find({
    bidId: newOrder.bidId,
    optionKey: oppositeOption,
    price: complementaryPrice,
    status: { $in: ["pending", "partly_filled"] }, // Include partly_filled orders
  }).sort({ createdAt: 1 }); // First in, first out

  // Filter out orders that are completely filled
  return matchingOrders.filter((order) => {
    const remainingQuantity = order.quantity - (order.filledQuantity || 0);
    return remainingQuantity > 0;
  });
};

// Updated helper function to execute matched orders with proper partial filling
const executeMatchedOrders = async (order1, order2, socketService) => {
  const executeQuantity = Math.min(
    order1.quantity - (order1.filledQuantity || 0),
    order2.quantity - (order2.filledQuantity || 0)
  );

  if (executeQuantity <= 0) return 0;

  // Initialize filledQuantity if not present
  if (!order1.filledQuantity) order1.filledQuantity = 0;
  if (!order2.filledQuantity) order2.filledQuantity = 0;

  // Update filled quantities
  order1.filledQuantity += executeQuantity;
  order2.filledQuantity += executeQuantity;

  // Update order status based on completion
  if (order1.filledQuantity >= order1.quantity) {
    order1.status = "filled";
  } else if (order1.filledQuantity > 0) {
    order1.status = "partly_filled";
  }

  if (order2.filledQuantity >= order2.quantity) {
    order2.status = "filled";
  } else if (order2.filledQuantity > 0) {
    order2.status = "partly_filled";
  }

  // Save both orders
  await order1.save({ validateBeforeSave: false });
  await order2.save({ validateBeforeSave: false });

  // Emit match notifications with proper status
  socketService.emitOrderMatched(order1.bidId, {
    orderId: order1._id,
    clerkId: order1.clerkId,
    optionKey: order1.optionKey,
    price: order1.price,
    quantity: executeQuantity,
    totalQuantity: order1.quantity,
    filledQuantity: order1.filledQuantity,
    status: order1.status,
  });

  socketService.emitOrderMatched(order2.bidId, {
    orderId: order2._id,
    clerkId: order2.clerkId,
    optionKey: order2.optionKey,
    price: order2.price,
    quantity: executeQuantity,
    totalQuantity: order2.quantity,
    filledQuantity: order2.filledQuantity,
    status: order2.status,
  });

  return executeQuantity;
};

// Order Related Routes - Updated with better order flow
app.post("/api/order", async (req, res) => {
  try {
    const { bidId, clerkId, optionKey, price, quantity } = req.body;
    const socketService = req.app.get("socketService");

    // Validate required fields
    if (
      !bidId ||
      !clerkId ||
      !optionKey ||
      price === undefined ||
      quantity === undefined
    ) {
      console.log("Missing required fields:", {
        bidId,
        clerkId,
        optionKey,
        price,
        quantity,
      });
      return res.status(400).json({ error: "All fields are required" });
    }

    // Validate bidId format
    if (!mongoose.Types.ObjectId.isValid(bidId)) {
      console.log("Invalid bidId format:", bidId);
      return res.status(400).json({ error: "Invalid bid ID format" });
    }

    // Validate price and quantity
    if (typeof price !== "number" || price <= 0 || price > 10) {
      console.log("Invalid price:", price, typeof price);
      return res
        .status(400)
        .json({ error: "Price must be a number between 0.1 and 10" });
    }

    if (
      typeof quantity !== "number" ||
      quantity <= 0 ||
      !Number.isInteger(quantity)
    ) {
      console.log("Invalid quantity:", quantity, typeof quantity);
      return res
        .status(400)
        .json({ error: "Quantity must be a positive integer" });
    }

    // Validate bidId exists
    const bid = await Bid.findById(bidId);
    if (!bid) {
      console.log("Bid not found:", bidId);
      return res.status(404).json({ error: "Bid not found" });
    }

    // Validate user exists
    const user = await User.findOne({ user_id: clerkId });
    if (!user) {
      console.log("User not found:", clerkId);
      return res.status(404).json({ error: "User not found" });
    }

    // Calculate total cost
    const totalCost = price * quantity;

    // Check if user has sufficient balance
    if (user.balance < totalCost) {
      console.log("Insufficient balance:", {
        balance: user.balance,
        cost: totalCost,
      });
      return res.status(400).json({ error: "Insufficient balance" });
    }

    // Create new order
    const newOrder = new Order({
      bidId,
      clerkId,
      optionKey,
      price: Number(price),
      quantity: Number(quantity),
      status: "pending",
      filledQuantity: 0,
    });

    await newOrder.save();
    console.log("Order saved successfully:", newOrder._id);

    // Deduct balance from user
    user.balance -= totalCost;
    await user.save();
    console.log("User balance updated:", user.balance);

    // Try to match orders with improved logic - NOW INCLUDES partly_filled orders
    const matchingOrders = await findMatchingOrders(newOrder);
    let remainingQuantity = newOrder.quantity;

    console.log(`Found ${matchingOrders.length} potential matching orders`);

    for (const matchingOrder of matchingOrders) {
      if (remainingQuantity <= 0) break;

      const availableQuantity =
        matchingOrder.quantity - (matchingOrder.filledQuantity || 0);
      console.log(
        `Matching order ${matchingOrder._id}: available quantity = ${availableQuantity}`
      );

      if (availableQuantity <= 0) continue;

      const matchedQuantity = await executeMatchedOrders(
        newOrder,
        matchingOrder,
        socketService
      );

      remainingQuantity -= matchedQuantity;
      console.log(
        `Matched ${matchedQuantity}, remaining: ${remainingQuantity}`
      );
    }

    // Refresh the order from database to get latest status
    await newOrder.reload();

    // Prepare order data for socket emissions
    const orderDataWithUser = {
      order: {
        _id: newOrder._id,
        bidId: newOrder.bidId,
        clerkId: newOrder.clerkId,
        optionKey: newOrder.optionKey,
        price: newOrder.price,
        quantity: newOrder.quantity,
        filledQuantity: newOrder.filledQuantity,
        status: newOrder.status,
        createdAt: newOrder.createdAt,
      },
      optionKey,
      message: "New order placed",
      userName: user.name || `User${user.user_id.slice(-4)}`,
      userId: user.user_id,
    };

    // Emit the updates
    socketService.emitOrderUpdate(bidId, orderDataWithUser);
    socketService.emitBalanceUpdate(clerkId, user.balance);

    // Emit updated order book data (this will also emit pricing updates)
    socketService.emitOrderBookUpdate(bidId);

    res.status(201).json({
      message: "Order placed successfully",
      order: newOrder,
      remainingBalance: user.balance,
    });
  } catch (error) {
    console.error("Error placing order:", error);

    // Handle validation errors specifically
    if (error.name === "ValidationError") {
      const firstError = Object.values(error.errors)[0];
      return res.status(400).json({
        error: "Order validation failed",
        details: firstError.message,
      });
    }

    res.status(500).json({
      error: "Internal server error",
      details: error.message,
    });
  }
});

// User Related
app.post("/api/create-user", async (req, res) => {
  try {
    const { user_id, name, email } = req.body;

    let existingUser = await User.findOne({ user_id });

    if (existingUser) {
      return res
        .status(200)
        .json({ message: "User already exists", user: existingUser });
    }

    const newUser = new User({
      user_id,
      name,
      email,
      balance: 0,
    });

    await newUser.save();
    res.status(201).json({ message: "User created", user: newUser });
  } catch (error) {
    console.error("Error creating user:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/get/user/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findOne({ user_id: id });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.status(200).json({ user });
  } catch (error) {
    console.error("Error fetching user:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/claim-reward", async (req, res) => {
  try {
    const { clerkId } = req.body;
    const socketService = req.app.get("socketService");

    if (!clerkId) {
      return res.status(400).json({ error: "Clerk ID is required" });
    }

    const user = await User.findOne({ user_id: clerkId });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (user.balance !== 0) {
      return res
        .status(400)
        .json({ error: "Reward can only be claimed when balance is 0" });
    }

    user.balance = 1100;
    await user.save();

    // Use SocketService for balance update
    socketService.emitBalanceUpdate(clerkId, user.balance);

    res.status(200).json({
      message: "Reward claimed successfully!",
      newBalance: user.balance,
    });
  } catch (error) {
    console.error("Error claiming reward:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Add this new endpoint before the Socket.IO connection handling
app.get("/api/get/dynamic-pricing/:bidId", async (req, res) => {
  try {
    const { bidId } = req.params;

    // Get all pending and partly_filled orders for this bid
    const orders = await Order.find({
      bidId,
      status: { $in: ["pending", "partly_filled"] },
    });

    // Group orders by option and price, considering remaining quantities
    const priceGroups = {};

    orders.forEach((order) => {
      const remainingQuantity = order.quantity - (order.filledQuantity || 0);
      if (remainingQuantity <= 0) return;

      const key = `${order.optionKey}_${order.price}`;
      if (!priceGroups[key]) {
        priceGroups[key] = {
          price: order.price,
          quantity: 0,
          option: order.optionKey,
        };
      }
      priceGroups[key].quantity += remainingQuantity;
    });

    // Find the price with maximum pending orders
    let maxQuantity = 0;
    let dominantPrice = null;
    let dominantOption = null;

    Object.values(priceGroups).forEach((group) => {
      if (group.quantity > maxQuantity) {
        maxQuantity = group.quantity;
        dominantPrice = group.price;
        dominantOption = group.option;
      }
    });

    // Calculate dynamic pricing
    let dynamicYesPrice = 5.0; // Default fallback
    let dynamicNoPrice = 5.0;

    if (dominantPrice !== null && dominantOption) {
      if (dominantOption === "Yes") {
        dynamicYesPrice = dominantPrice;
        dynamicNoPrice = 10 - dominantPrice;
      } else {
        dynamicNoPrice = dominantPrice;
        dynamicYesPrice = 10 - dominantPrice;
      }
    }

    res.status(200).json({
      dynamicYesPrice,
      dynamicNoPrice,
      dominantOption,
      dominantPrice,
      maxQuantity,
      fallbackToDefault: dominantPrice === null,
    });
  } catch (error) {
    console.error("Error calculating dynamic pricing:", error);
    res.status(500).json({
      error: "Internal server error",
      dynamicYesPrice: 5.0,
      dynamicNoPrice: 5.0,
      fallbackToDefault: true,
    });
  }
});

// Add this new endpoint for fetching user orders
app.get("/api/get/user-orders/:clerkId/:bidId", async (req, res) => {
  try {
    const { clerkId, bidId } = req.params;

    const orders = await Order.find({
      clerkId,
      bidId,
    }).sort({ createdAt: -1 });

    res.status(200).json({ orders });
  } catch (error) {
    console.error("Error fetching user orders:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Replace the existing order depth endpoint
app.get("/api/get/order-depth/:bidId", async (req, res) => {
  try {
    const { bidId } = req.params;

    // Get all pending and partly_filled orders for this bid
    const orders = await Order.find({
      bidId,
      status: { $in: ["pending", "partly_filled"] },
    }).sort({ price: -1 });

    // Group orders by option and price, considering remaining quantities
    const yesOrders = [];
    const noOrders = [];

    // Aggregate orders by price with remaining quantities
    const priceGroups = {};

    orders.forEach((order) => {
      const remainingQuantity = order.quantity - (order.filledQuantity || 0);
      if (remainingQuantity <= 0) return; // Skip fully filled orders

      // FIXED: Show opposite option at complementary price
      const complementaryPrice = 10 - order.price;
      const oppositeOption = order.optionKey === "Yes" ? "No" : "Yes";

      const key = `${oppositeOption}_${complementaryPrice}`;
      if (!priceGroups[key]) {
        priceGroups[key] = {
          price: complementaryPrice,
          quantity: 0,
          option: oppositeOption,
        };
      }
      priceGroups[key].quantity += remainingQuantity;
    });

    // Separate into yes and no orders
    Object.values(priceGroups).forEach((group) => {
      if (group.quantity > 0) {
        // Only include groups with remaining quantity
        if (group.option === "Yes") {
          yesOrders.push({ price: group.price, quantity: group.quantity });
        } else {
          noOrders.push({ price: group.price, quantity: group.quantity });
        }
      }
    });

    // Sort orders
    yesOrders.sort((a, b) => b.price - a.price); // Descending for yes
    noOrders.sort((a, b) => a.price - b.price); // Ascending for no

    res.status(200).json({
      depth: {
        yes: yesOrders,
        no: noOrders,
      },
    });
  } catch (error) {
    console.error("Error fetching order depth:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Add this route before the Socket.IO connection handling
app.post("/api/resolve-event", async (req, res) => {
  try {
    const { bidId, resolution, clerkId } = req.body;
    const socketService = req.app.get("socketService");

    // Validate admin access (you can modify this logic as needed)
    if (clerkId !== "user_31EJ9jzTGNPdgsTBT6YFl96E8of") {
      return res
        .status(403)
        .json({ error: "Unauthorized: Admin access required" });
    }

    // Validate required fields
    if (!bidId || !resolution || !["Yes", "No"].includes(resolution)) {
      return res.status(400).json({
        error: "Invalid request. Resolution must be 'Yes' or 'No'",
      });
    }

    // Validate bidId exists
    const bid = await Bid.findById(bidId);
    if (!bid) {
      return res.status(404).json({ error: "Bid not found" });
    }

    // Check if already resolved
    if (bid.status === "resolved") {
      return res.status(400).json({ error: "Event already resolved" });
    }

    // Get all orders for this bid
    const allOrders = await Order.find({ bidId });

    // Separate orders by status and option
    const filledOrders = allOrders.filter((order) => order.status === "filled");
    const pendingOrders = allOrders.filter(
      (order) => order.status === "pending"
    );

    // Group users and their winnings/refunds
    const userPayouts = {};
    const userRefunds = {};

    // Calculate winnings for filled orders
    filledOrders.forEach((order) => {
      const isWinner = order.optionKey === resolution;

      if (!userPayouts[order.clerkId]) {
        userPayouts[order.clerkId] = { winnings: 0, refunds: 0, orders: [] };
      }

      if (isWinner) {
        // Calculate winnings: cost + (10 - cost) * 0.9
        const cost = order.price * order.quantity;
        const potentialReturn = order.quantity * 10; // Max payout is ₹10 per share
        const winnings = cost + (potentialReturn - cost) * 0.9;

        userPayouts[order.clerkId].winnings += winnings;
        userPayouts[order.clerkId].orders.push({
          ...order.toObject(),
          winnings,
          type: "win",
        });
      } else {
        // Losers get nothing for filled orders
        userPayouts[order.clerkId].orders.push({
          ...order.toObject(),
          winnings: 0,
          type: "loss",
        });
      }
    });

    // Calculate refunds for pending orders
    pendingOrders.forEach((order) => {
      const refundAmount = order.price * order.quantity;

      if (!userRefunds[order.clerkId]) {
        userRefunds[order.clerkId] = 0;
      }

      userRefunds[order.clerkId] += refundAmount;

      if (!userPayouts[order.clerkId]) {
        userPayouts[order.clerkId] = { winnings: 0, refunds: 0, orders: [] };
      }

      userPayouts[order.clerkId].refunds += refundAmount;
      userPayouts[order.clerkId].orders.push({
        ...order.toObject(),
        refund: refundAmount,
        type: "refund",
      });
    });

    // Update user balances
    const updatePromises = [];
    const notificationPromises = [];

    for (const [userId, payout] of Object.entries(userPayouts)) {
      const totalPayout = payout.winnings + payout.refunds;

      if (totalPayout > 0) {
        // Update user balance
        const updatePromise = User.findOneAndUpdate(
          { user_id: userId },
          { $inc: { balance: totalPayout } },
          { new: true }
        );
        updatePromises.push(updatePromise);
      }
    }

    // Execute all balance updates
    const updatedUsers = await Promise.all(updatePromises);

    // Update all orders to resolved status
    await Order.updateMany({ bidId }, { $set: { status: "resolved" } });

    // Update bid status
    await Bid.findByIdAndUpdate(bidId, {
      status: "resolved",
      resolution: resolution,
      resolvedAt: new Date(),
    });

    // Send notifications to all users
    let userIndex = 0;
    for (const [userId, payout] of Object.entries(userPayouts)) {
      const totalPayout = payout.winnings + payout.refunds;

      if (totalPayout > 0) {
        // Get the updated user's new balance
        const updatedUser = updatedUsers[userIndex];
        const newBalance = updatedUser ? updatedUser.balance : totalPayout;

        // Emit balance update with the new total balance, not just the payout
        socketService.emitBalanceUpdate(userId, newBalance);

        // Emit resolution notification
        socketService.io.to(`user_${userId}`).emit("eventResolved", {
          bidId,
          resolution,
          totalPayout,
          winnings: payout.winnings,
          refunds: payout.refunds,
          orders: payout.orders,
        });

        userIndex++;
      }
    }

    // Emit global resolution notification
    socketService.io.to(`bid_${bidId}`).emit("eventResolved", {
      bidId,
      resolution,
      resolvedAt: new Date(),
      totalPayouts: Object.keys(userPayouts).length,
    });

    res.status(200).json({
      message: `Event resolved successfully. Winner: ${resolution}`,
      resolution,
      totalUsers: Object.keys(userPayouts).length,
      totalWinnings: Object.values(userPayouts).reduce(
        (sum, p) => sum + p.winnings,
        0
      ),
      totalRefunds: Object.values(userPayouts).reduce(
        (sum, p) => sum + p.refunds,
        0
      ),
    });
  } catch (error) {
    console.error("Error resolving event:", error);
    res.status(500).json({
      error: "Internal server error",
      details: error.message,
    });
  }
});

// NEW: Weather API Routes

// Get current weather data from database - UPDATE THIS ENDPOINT
app.get("/api/get/weather", async (req, res) => {
  try {
    // Get last 4 weather records instead of just 1
    const weatherRecords = await Weather.find({ isActive: true })
      .sort({ createdAt: -1 })
      .limit(4);

    if (!weatherRecords || weatherRecords.length === 0) {
      return res.status(404).json({
        error: "No weather data available",
        message: "Please update market data first",
      });
    }

    res.status(200).json({ weatherHistory: weatherRecords });
  } catch (error) {
    console.error("Error fetching weather:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Admin endpoint to fetch and store new weather data
app.post("/api/admin/update-weather", async (req, res) => {
  try {
    const { clerkId } = req.body;
    const socketService = req.app.get("socketService");

    // Validate admin access
    if (clerkId !== "user_31EJ9jzTGNPdgsTBT6YFl96E8of") {
      return res
        .status(403)
        .json({ error: "Unauthorized: Admin access required" });
    }

    // Get API key from environment variable
    const API_KEY = process.env.WEATHERSTACK_API_KEY;
    if (!API_KEY) {
      return res.status(500).json({
        error: "Weather API key not configured",
        message: "Please set WEATHERSTACK_API_KEY in environment variables",
      });
    }

    // Fetch weather data from WeatherStack API
    const fetch = require("node-fetch"); // You might need to install: npm install node-fetch@2
    const response = await fetch(
      `http://api.weatherstack.com/current?access_key=${API_KEY}&query=New%20Delhi`
    );

    if (!response.ok) {
      throw new Error(`WeatherStack API error: ${response.status}`);
    }

    const weatherApiData = await response.json();

    if (weatherApiData.error) {
      throw new Error(weatherApiData.error.info || "Weather API error");
    }

    // Create new weather record in database
    const newWeather = new Weather({
      location: weatherApiData.location,
      current: weatherApiData.current,
      fetchedAt: new Date(),
      isActive: true,
    });

    await newWeather.save();

    // Emit weather update to all connected users
    socketService.emitWeatherUpdate({
      weather: newWeather,
      message: "Weather data updated",
      updatedBy: "Admin",
      timestamp: new Date(),
    });

    res.status(200).json({
      message: "Weather data updated successfully",
      weather: newWeather,
      timestamp: new Date(),
    });
  } catch (error) {
    console.error("Error updating weather:", error);
    res.status(500).json({
      error: "Failed to update weather data",
      details: error.message,
    });
  }
});

// Socket.IO connection handling
io.on("connection", (socket) => {
  console.log("A user connected:", socket.id);

  // Handle user joining specific bid rooms
  socket.on("joinBid", (bidId) => {
    socket.join(`bid_${bidId}`);
    console.log(`User ${socket.id} joined bid room: ${bidId}`);

    // Send current user count to the bid room
    const userCount = socketService.getBidRoomUserCount(bidId);
    io.to(`bid_${bidId}`).emit("bidRoomUserCount", { bidId, userCount });
  });

  // Handle user leaving bid rooms
  socket.on("leaveBid", (bidId) => {
    socket.leave(`bid_${bidId}`);
    console.log(`User ${socket.id} left bid room: ${bidId}`);

    // Send updated user count to the bid room
    const userCount = socketService.getBidRoomUserCount(bidId);
    io.to(`bid_${bidId}`).emit("bidRoomUserCount", { bidId, userCount });
  });

  // Handle user joining their personal room for balance updates
  socket.on("joinUser", (clerkId) => {
    socket.join(`user_${clerkId}`);
    console.log(`User ${socket.id} joined user room: ${clerkId}`);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

connectDB().then(() => {
  server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
});
