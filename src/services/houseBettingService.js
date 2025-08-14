const Order = require("../models/OrderSchema");
const Bid = require("../models/BidSchema");

class HouseBettingService {
  // Calculate metrics for a specific bid (including pending orders)
  static async calculateBidMetrics(bidId, includePending = false) {
    const statusFilter = includePending
      ? { $in: ["filled", "pending", "partly_filled"] }
      : "filled";

    // Get orders based on whether we want to include pending
    const orders = await Order.find({
      bidId,
      status: statusFilter,
    });

    let totalMoneyCollected = 0;
    let yesOrdersValue = 0;
    let noOrdersValue = 0;

    orders.forEach((order) => {
      const orderValue = order.price * order.quantity;
      totalMoneyCollected += orderValue;

      if (order.optionKey === "Yes") {
        yesOrdersValue += orderValue;
      } else {
        noOrdersValue += orderValue;
      }
    });

    // Calculate max liability (worst case scenario)
    const maxLiabilityIfYesWins = orders
      .filter((order) => order.optionKey === "Yes")
      .reduce((total, order) => total + order.quantity * 10, 0);

    const maxLiabilityIfNoWins = orders
      .filter((order) => order.optionKey === "No")
      .reduce((total, order) => total + order.quantity * 10, 0);

    const maxLiability = Math.max(maxLiabilityIfYesWins, maxLiabilityIfNoWins);
    const platformProfit = totalMoneyCollected - maxLiability;

    return {
      totalMoneyCollected,
      maxLiability,
      platformProfit,
      yesOrdersValue,
      noOrdersValue,
      maxLiabilityIfYesWins,
      maxLiabilityIfNoWins,
      isProfitable: totalMoneyCollected >= maxLiability,
      orders: orders,
    };
  }

  // NEW: Check if executing ALL pending orders would be profitable
  static async shouldExecuteAllPendingOrders(bidId) {
    // Get all pending and partly_filled orders
    const pendingOrders = await Order.find({
      bidId,
      status: { $in: ["pending", "partly_filled"] },
    });

    if (pendingOrders.length === 0) {
      return { shouldExecute: false, reason: "No pending orders" };
    }

    // Calculate what would happen if we execute ALL pending orders
    const currentFilledMetrics = await this.calculateBidMetrics(bidId, false); // Only filled
    const allOrdersMetrics = await this.calculateBidMetrics(bidId, true); // Including pending

    const isProfitable = allOrdersMetrics.isProfitable;

    console.log(`📊 House Betting Analysis for Bid ${bidId}:`);
    console.log(
      `💰 Total money (including pending): ₹${allOrdersMetrics.totalMoneyCollected}`
    );
    console.log(`⚠️ Max liability: ₹${allOrdersMetrics.maxLiability}`);
    console.log(`📈 Platform profit: ₹${allOrdersMetrics.platformProfit}`);
    console.log(`✅ Is profitable: ${isProfitable}`);

    return {
      shouldExecute: isProfitable,
      pendingOrders,
      metrics: allOrdersMetrics,
      reason: isProfitable
        ? "Profitable for platform"
        : "Not profitable - would lose money",
    };
  }

  // Execute ALL pending orders via house system
  static async executeAllPendingOrders(bidId, socketService) {
    const analysis = await this.shouldExecuteAllPendingOrders(bidId);

    if (!analysis.shouldExecute) {
      console.log(`🚫 Not executing pending orders: ${analysis.reason}`);
      return { executed: false, reason: analysis.reason };
    }

    console.log(
      `🏠 Executing ${analysis.pendingOrders.length} pending orders via house system`
    );

    const executedOrders = [];

    // Execute all pending orders
    for (const order of analysis.pendingOrders) {
      // Fill the remaining quantity
      const remainingQuantity = order.quantity - (order.filledQuantity || 0);

      if (remainingQuantity > 0) {
        order.filledQuantity = order.quantity;
        order.status = "filled";
        await order.save();

        executedOrders.push(order);

        // Emit individual order completion
        socketService.emitOrderMatched(bidId, {
          orderId: order._id,
          clerkId: order.clerkId,
          optionKey: order.optionKey,
          price: order.price,
          quantity: remainingQuantity,
          totalQuantity: order.quantity,
          filledQuantity: order.quantity,
          status: "filled",
          executionType: "house",
        });
      }
    }

    // Update bid metrics
    const finalMetrics = await this.calculateBidMetrics(bidId, false); // Only filled now
    await this.updateBidMetrics(bidId, finalMetrics);

    // Update house executed orders counter
    await Bid.findByIdAndUpdate(bidId, {
      $inc: { houseExecutedOrders: executedOrders.length },
    });

    console.log(
      `🎯 House executed ${executedOrders.length} orders - Platform profit: ₹${finalMetrics.platformProfit}`
    );

    return {
      executed: true,
      executedOrders,
      metrics: finalMetrics,
      count: executedOrders.length,
    };
  }

  // Update bid metrics in database
  static async updateBidMetrics(bidId, metrics) {
    await Bid.findByIdAndUpdate(bidId, {
      totalMoneyCollected: metrics.totalMoneyCollected,
      maxLiability: metrics.maxLiability,
      platformProfit: metrics.totalMoneyCollected - metrics.maxLiability,
      yesOrdersValue: metrics.yesOrdersValue,
      noOrdersValue: metrics.noOrdersValue,
    });
  }

  // Legacy method - keeping for compatibility but not using in main flow
  static async canExecuteOrderProfitably(bidId, newOrder) {
    const currentMetrics = await this.calculateBidMetrics(bidId, true); // Include pending
    return {
      isProfitable: currentMetrics.isProfitable,
      metrics: currentMetrics,
    };
  }
}

module.exports = HouseBettingService;
