const User = require("../../models/userSchema");
const mongoose = require("mongoose");

const loadUsers = async (req, res) => {
  try {
    // Add pagination
    const page = parseInt(req.query.page) || 1;
    const limit = 5; // Items per page
    const skip = (page - 1) * limit;

    // Fetch users with pagination
    const users = await User.find({ isAdmin: { $exists: false } })
      .select("name email isBlocked")
      .skip(skip)
      .limit(limit);

    // Get total count for pagination
    const totalUsers = await User.countDocuments();
    const totalPages = Math.ceil(totalUsers / limit);

    res.render("users", {
      users,
      currentPage: page,
      totalPages,
      totalUsers,
    });
  } catch (error) {
    console.error("Error loading users:", error);
    res.status(500).render("error", {
      message: "Error loading users",
      error:
        process.env.NODE_ENV === "development"
          ? error.message
          : "Internal server error",
    });
  }
};

const toggleBlock = async (req, res) => {
  try {
    const userId = req.params.id;
    const { status } = req.body;

    // Validate userId
    if (!userId) {
      return res.status(400).json({ message: "User ID is required" });
    }

    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Convert the string status to boolean for isBlocked
    user.isBlocked = status === "true";
    await user.save();

    return res.json({
      success: true,
      status: user.isBlocked.toString(), // Convert back to string for frontend
      message: `User ${user.isBlocked ? "blocked" : "unblocked"} successfully`,
    });
  } catch (error) {
    console.error("Error toggling block status:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

module.exports = {
  toggleBlock,
  loadUsers,
};
