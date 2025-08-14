const mongoose = require("mongoose");

const { Schema, model } = mongoose;

const BidSchema = new Schema(
  {
    question: {
      type: String,
      required: true,
      trim: true,
      maxlength: 300,
    },

    category: {
      type: String,
      required: true,
      trim: true,
      maxlength: 60,
    },

    yesPrice: {
      type: Number,
      required: true,
      min: 0.5,
      max: 9.5,
      default: 5.0,
    },

    volume: {
      type: Number,
      default: 0,
      min: 0,
    },

    endTime: {
      type: Date,
      required: true,
    },

    image: {
      type: String,
      required: false,
    },

    status: {
      type: String,
      enum: ["active", "resolved", "cancelled"],
      default: "active",
    },
    resolution: {
      type: String,
      enum: ["Yes", "No"],
      default: null,
    },
    resolvedAt: {
      type: Date,
      default: null,
    },

    // NEW: Platform risk tracking fields
    totalMoneyCollected: {
      type: Number,
      default: 0,
      min: 0,
    },
    maxLiability: {
      type: Number,
      default: 0,
      min: 0,
    },
    platformProfit: {
      type: Number,
      default: 0,
    },
    yesOrdersValue: {
      type: Number,
      default: 0,
      min: 0,
    },
    noOrdersValue: {
      type: Number,
      default: 0,
      min: 0,
    },
    // Track orders executed via house system vs matching
    houseExecutedOrders: {
      type: Number,
      default: 0,
    },
    matchedOrders: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

module.exports = mongoose.models.Bid || model("Bid", BidSchema);
