const mongoose = require("mongoose");
const path = require("path");
const dotenv = require("dotenv");

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, ".env") });

// Import Bid schema
const Bid = require("./src/models/BidSchema");
const connectDB = require("./src/config/db");

// Sample data to be seeded
const SAMPLE = [
  {
    question:
      "Will the temperature in Delhi be above 38°C before 15 Aug 11:59PM?",
    category: "General",
    yesPrice: 5.0, // Converted from 62%
    volume: 0,
    participants: 0,
    deadline: "Closes at 15-8-25, 11:59 PM",
    image: "/Delhi.jpg",
  },
  {
    question: "Claude 5 release before 2025 end?",
    category: "Tech",
    yesPrice: 5.0, // Converted from 48%
    volume: 0,
    participants: 0,
    deadline: "Closes at 14-8-25, 10:59 AM",
    image: "/claude.webp",
  },
  {
    question: "Jeff Bezos to become richest man again?",
    category: "Finance",
    yesPrice: 5.0, // Converted from 39%
    volume: 0,
    participants: 0,
    deadline: "Closes at 14-10-25, 11:59 PM",
    image: "/jeff.jpg",
  },
  {
    question: "Ethereum above $3800 on August 17?",
    category: "Crypto",
    yesPrice: 5.0, // Converted from 22%
    volume: 0,
    participants: 0,
    deadline: "Closes at 13-8-25, 11:59 PM",
    image: "/eth.jpg",
  },
];

// Helper function to parse deadline string into a future date
const parseDeadline = (deadline) => {
  const now = new Date();
  const hoursMatch = deadline.match(/(\d+)h/);
  const daysMatch = deadline.match(/(\d+)d/);

  if (hoursMatch) {
    const hours = parseInt(hoursMatch[1]);
    now.setHours(now.getHours() + hours);
  }
  if (daysMatch) {
    const days = parseInt(daysMatch[1]);
    now.setDate(now.getDate() + days);
  }

  return now;
};

const seedBids = async () => {
  try {
    await connectDB();
    console.log("Connected to MongoDB.");

    // Clear existing bid data
    await Bid.deleteMany({});
    console.log("Existing bids cleared.");

    const formattedBids = SAMPLE.map((item) => ({
      question: item.question,
      category: item.category,
      yesPrice: item.yesShare, // Directly using yesShare as the price
      volume: item.volume,
      endTime: parseDeadline(item.deadline),
      image: item.image,
    }));

    await Bid.insertMany(formattedBids);
    console.log("Database seeded with sample bids!");
  } catch (error) {
    console.error("Error seeding database:", error);
  } finally {
    mongoose.connection.close();
  }
};

seedBids();
