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
      const status = req.body.status;

      console.log('Toggle block request:', { userId, status }); // Debug log

      // Validate userId
      if (!mongoose.Types.ObjectId.isValid(userId)) {
          return res.status(400).json({
              success: false,
              message: "Invalid user ID format"
          });
      }

      const user = await User.findById(userId);

      if (!user) {
          return res.status(404).json({
              success: false,
              message: "User not found"
          });
      }

      // Update user status
      user.isBlocked = Boolean(status);
      await user.save();

      // Send JSON response
      return res.status(200).json({
          success: true,
          message: `User has been ${user.isBlocked ? 'blocked' : 'unblocked'} successfully`,
          status: user.isBlocked
      });

  } catch (error) {
      console.error('Toggle block error:', error);
      
      // Ensure we always send JSON response
      return res.status(500).json({
          success: false,
          message: "An error occurred while updating user status",
          error: error.message
      });
  }
};

module.exports = {
  toggleBlock,
  loadUsers,
};
