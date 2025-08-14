const mongoose = require("mongoose");

const weatherSchema = new mongoose.Schema(
  {
    location: {
      name: String,
      region: String,
      country: String,
      lat: String,
      lon: String,
      timezone_id: String,
      localtime: String,
      localtime_epoch: Number,
      utc_offset: String,
    },
    current: {
      observation_time: String,
      temperature: Number,
      weather_code: Number,
      weather_icons: [String],
      weather_descriptions: [String],
      wind_speed: Number,
      wind_degree: Number,
      wind_dir: String,
      pressure: Number,
      precip: Number,
      humidity: Number,
      cloudcover: Number,
      feelslike: Number,
      uv_index: Number,
      visibility: Number,
    },
    fetchedAt: {
      type: Date,
      default: Date.now,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// Remove the pre-save hook that was deactivating old records
// Keep all records active so we can show history

module.exports = mongoose.model("Weather", weatherSchema);
