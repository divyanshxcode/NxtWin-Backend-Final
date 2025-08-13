// src/models/UserSchema.js
const mongoose = require("mongoose");
const { Schema, model } = mongoose;

const UserSchema = new Schema(
  {
    user_id: {
      type: String,
      required: true,
      unique: true, // Clerk's user ID
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    email: {
      type: String,
      required: true,
      unique: true, // ensures only 1 account per email
      trim: true,
      lowercase: true,
    },
    balance: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { timestamps: true, versionKey: false }
);

module.exports = mongoose.models.User || model("User", UserSchema);
