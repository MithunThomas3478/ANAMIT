const express = require("express");
const adminController = require("../controllers/admin/adminController");
const customerController = require("../controllers/admin/customersController");
const categoryController = require('../controllers/admin/categoryController');

const router = express.Router();
const { userAuh, adminAuth, adminAuthMiddleware } = require("../middlewares/auth");

router.get("/login", adminController.loadLogin);
router.post("/login", adminController.adminLogin);
router.use(adminAuthMiddleware)
router.get("/dashboard", adminController.loadDashboard);
router.get("/pageerror", adminController.pageerror);
router.get("/logout", adminController.logout);

// Route for loading users page
router.get("/users", customerController.loadUsers);

// Route for toggling user block status
router.post("/users/toggle-block/:id", customerController.toggleBlock);

// Route for loading categories page
router.get("/categories", categoryController.getCatergoryPages);


module.exports = router;
