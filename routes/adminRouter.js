const express = require("express");
const adminController = require("../controllers/admin/adminController");
const customerController = require("../controllers/admin/customersController");
const categoryController = require('../controllers/admin/categoryController');
const productController = require('../controllers/admin/productController');
const orderController = require('../controllers/admin/orderController');
const offerController = require('../controllers/admin/offerController');
const couponController = require('../controllers/admin/couponController');
const salesController = require('../controllers/admin/salesReportController')
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
// In your admin routes file
router.post("/product/toggle/:id", productController.toggleProductStatus);

// Category routes
router.get('/category',categoryController.loadCategory);

router.get('/categoryAdd', categoryController.renderAddCategoryForm);

router.post('/categoryAdd',categoryController.addCategory);
router.get('/category/edit/:id',categoryController.loadEditPage);
router.put('/category/update/:id',categoryController.updateCategory);
router.patch('/category/:id/toggle-status', categoryController.toggleStatus);
router.delete('/category/:id/delete',categoryController.deleteCategory);


router.get('/addProduct',productController.loadAddCategory);
router.post('/addProduct',newUploads,productController.addProducts);
router.get('/product',productController.loadProductPage);

router.patch('/product/:id/toggle-status', productController.toggleProductStatus);


// edit product
router.get('/editProduct',productController.loadEditProduct);

router.post('/editProduct/:id',newUploads,productController.editProduct);

router.get('/orders',orderController.getOrderManagement);
router.patch('/order/:orderId/update-status', orderController.updateOrderStatus);
router.get('/order/:orderId/invoice', orderController.generateInvoice);
router.get('/order/view/:orderId', orderController.getOrderDetails);


router.get('/offers',offerController.getOfferManagement);
router.get('/offers/add', offerController.getAddOffer);
router.get('/offers/:id', offerController.getOfferById);
router.post('/offers/add', offerController.addOffer);
router.get('/offers/edit/:id', offerController.getEditOffer);
router.post('/offers/edit/:id', offerController.updateOffer);
router.patch('/offers/:id/toggle-status', offerController.toggleOfferStatus);

router.get('/coupons', couponController.getCouponTemplate);
router.get('/coupons/add', couponController.getAddCoupon);
router.post('/coupons/add', couponController.addCoupon);
router.get('/coupons/edit/:id', couponController.getEditCouponPage);
router.post('/coupons/edit/:id', couponController.updateCoupon);
router.post('/coupons/:id/toggle', couponController.toggleCouponStatus);
router.delete('/coupons/delete/:id', couponController.deleteCoupon);

router.get('/sales-report/:type?',salesController.getSalesReport);
router.get('/sales-report/export/:format/:type', salesController.exportSalesReport);
// Add these to your existing routes
router.post('/orders/:orderId/items/:itemId/return/:action', orderController.handleReturnRequest);



module.exports = router;    
