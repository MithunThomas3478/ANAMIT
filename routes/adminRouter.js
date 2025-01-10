const express = require("express");
const adminController = require("../controllers/admin/adminController");
const customerController = require("../controllers/admin/customersController");
const categoryController = require('../controllers/admin/categoryController');
const productController = require('../controllers/admin/productController')
const multer = require('multer')
const upload = multer();
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const router = express.Router();
const { adminAuthMiddleware } = require("../middlewares/auth");




// Configure disk storage
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'public/uploads/product-images');
    },
    filename: function (req, file, cb) {
        const ext = file.originalname.split('.').pop(); // Extract file extension
        cb(null,`${uuidv4()}.${ext}`); // Unique filename
    }
});
const newUploads = multer({
    storage: multer.memoryStorage(), // stores the memory good gor processing with sharp
    fileFilter: function(req, file, cb) {
        // Accept images only
        if (!file.originalname.match(/\.(jpg|JPG|jpeg|JPEG|png|PNG|gif|GIF|webp|WEBP)$/)) {
            req.fileValidationError = 'Only image files are allowed!';
            return cb(null, false);
        }
        cb(null, true);
    }
}).any();


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

// Category routes
router.get('/category',categoryController.loadCategory);

router.get('/categoryAdd', categoryController.renderAddCategoryForm);

router.post('/categoryAdd',categoryController.addCategory);
router.get('/category/edit/:id',categoryController.loadEditPage);
router.put('/category/update/:id',categoryController.updateCategory);
router.patch('/category/:id/toggle-status', categoryController.toggleStatus);
router.delete('/category/:id/delete',categoryController.deleteCategory);

router.delete('/product/delete/:id', productController.deleteProduct);
router.get('/addProduct',productController.loadAddCategory);
router.post('/addProduct',newUploads,productController.addProducts);
router.get('/product',productController.loadProductPage);

router.post('/product/toggle/:id',productController.toggleProductStatus);

// router.get('/blockProduct',productController.blockProduct);

// router.get('/unblockProduct',productController.unBlockProduct);
// block and unblock product ends

// edit product
router.get('/editProduct',productController.loadEditProduct);

router.post('/editProduct/:id',newUploads,productController.editProduct);


module.exports = router;
