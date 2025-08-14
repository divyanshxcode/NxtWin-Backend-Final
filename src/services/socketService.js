class SocketService {
  constructor(io) {
    this.io = io;
  }

  // Emit order updates to specific bid room
  emitOrderUpdate(bidId, orderData) {
    this.io.to(`bid_${bidId}`).emit("orderUpdate", orderData);
  }

  // Emit balance updates to specific user
  emitBalanceUpdate(clerkId, balance) {
    this.io.to(`user_${clerkId}`).emit("balanceUpdate", {
      clerkId,
      newBalance: balance,
    });
  }

  // Emit bid match updates
  emitBidMatch(bidId, matchData) {
    this.io.to(`bid_${bidId}`).emit("bidMatch", matchData);
  }

  // Emit global order placed notification
  emitGlobalOrderUpdate(orderData) {
    this.io.emit("globalOrderUpdate", orderData);
  }

  // Get active users count in a bid room
  getBidRoomUserCount(bidId) {
    const room = this.io.sockets.adapter.rooms.get(`bid_${bidId}`);
    return room ? room.size : 0;
  }

  // Emit real-time price updates
  emitPriceUpdate(bidId, priceData) {
    this.io.to(`bid_${bidId}`).emit("priceUpdate", priceData);
  }

  // Emit order book updates - FIXED METHOD
  async emitOrderBookUpdate(bidId) {
    try {
      const Order = require("../models/OrderSchema");

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

      const orderBookData = {
        depth: {
          yes: yesOrders,
          no: noOrders,
        },
      };

      this.io.to(`bid_${bidId}`).emit("orderBookUpdate", orderBookData);
    } catch (error) {
      console.error("Error emitting order book update:", error);
    }
  }

  emitOrderMatched(bidId, matchData) {
    this.io.to(`bid_${bidId}`).emit("orderMatched", matchData);
    this.io.to(`user_${matchData.clerkId}`).emit("orderMatched", matchData);
  }

  // Add new method for event resolution
  emitEventResolution(bidId, resolutionData) {
    this.io.to(`bid_${bidId}`).emit("eventResolved", resolutionData);
  }

  // Emit resolution notification to specific user
  emitUserResolution(clerkId, userData) {
    this.io.to(`user_${clerkId}`).emit("eventResolved", userData);
  }

  // NEW: Emit dynamic pricing updates
  async emitDynamicPricingUpdate(bidId) {
    try {
      const Order = require("../models/OrderSchema");

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

      const pricingData = {
        bidId,
        dynamicYesPrice,
        dynamicNoPrice,
        dominantOption,
        dominantPrice,
        maxQuantity,
        fallbackToDefault: dominantPrice === null,
        timestamp: new Date(),
      };

      this.io.to(`bid_${bidId}`).emit("dynamicPricingUpdate", pricingData);
    } catch (error) {
      console.error("Error emitting dynamic pricing update:", error);
    }
  }

  // NEW: Emit weather updates to all connected users
  emitWeatherUpdate(weatherData) {
    this.io.emit("weatherUpdate", weatherData);
    console.log("Weather update emitted to all users");
  }
}

module.exports = SocketService;
