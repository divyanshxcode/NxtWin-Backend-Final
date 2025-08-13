const mongoose = require("mongoose");
const { Schema, model } = mongoose;

const OrderSchema = new Schema(
  {
    bidId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Bid",
      required: true,
    },
    clerkId: {
      type: String,
      required: true,
    },
    optionKey: {
      type: String,
      enum: ["Yes", "No"],
      required: true,
    },
    price: {
      type: Number,
      required: true,
      min: 0.1,
      max: 10,
    },
    quantity: {
      type: Number,
      required: true,
      min: [1, "Quantity must be at least 1"],
      validate: {
        validator: function (value) {
          // Allow 0 quantity only when status is 'filled'
          if (this.status === "filled") {
            return value >= 0;
          }
          return value >= 1;
        },
        message: "Quantity must be at least 1 for pending orders",
      },
    },
    status: {
      type: String,
      enum: ["pending", "partly_filled", "filled", "cancelled"], // Added partly_filled
      default: "pending",
    },
    filledQuantity: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Add a method to reload the document from database
OrderSchema.methods.reload = async function () {
  const fresh = await this.constructor.findById(this._id);
  if (fresh) {
    Object.assign(this, fresh.toObject());
  }
  return this;
};

module.exports = mongoose.models.Order || model("Order", OrderSchema);
