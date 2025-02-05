const Coupon = require('../../models/couponSchema');
const User = require('../../models/userSchema');
const Category = require('../../models/categorySchema');
const Product = require('../../models/productSchema');

const getCouponTemplate = async (req, res) => {
    try {
        // Get query parameters for filtering and pagination
        const { 
            searchQuery,
            discountType,
            status,
            validOnly,
            page = 1 // Default to first page
        } = req.query;

        const limit = 10; // Items per page
        const skip = (page - 1) * limit;

        // Build filter object
        let filter = {};
        
        // Search filter
        if (searchQuery) {
            filter.$or = [
                { code: new RegExp(searchQuery, 'i') },
                { description: new RegExp(searchQuery, 'i') }
            ];
        }

        // Discount type filter
        if (discountType) {
            filter.discountType = discountType;
        }

        // Status filter
        if (status) {
            const currentDate = new Date();
            switch(status) {
                case 'active':
                    filter.isActive = true;
                    filter.validUntil = { $gt: currentDate };
                    break;
                case 'inactive':
                    filter.isActive = false;
                    break;
                case 'expired':
                    filter.validUntil = { $lt: currentDate };
                    break;
            }
        }

        // Valid only filter
        if (validOnly === 'true') {
            const currentDate = new Date();
            filter.validFrom = { $lte: currentDate };
            filter.validUntil = { $gte: currentDate };
        }

        // Get total count for pagination
        const totalCoupons = await Coupon.countDocuments(filter);
        const totalPages = Math.ceil(totalCoupons / limit);

        // Fetch coupons with pagination
        const coupons = await Coupon.find(filter)
            .populate('applicableProducts', 'productName')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        // Format dates and add computed properties
        const enhancedCoupons = coupons.map(coupon => {
            const couponObj = coupon.toObject();
            const currentDate = new Date();
            
            // Format dates
            couponObj.formattedValidFrom = coupon.validFrom.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric'
            });
            
            couponObj.formattedValidUntil = coupon.validUntil.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric'
            });

            // Add status information
            couponObj.isExpired = currentDate > coupon.validUntil;
            couponObj.isExhausted = coupon.usageLimit !== null && 
                coupon.usageCount >= coupon.usageLimit;

            // Add status class for badge
            if (!coupon.isActive) {
                couponObj.statusClass = 'bg-warning';
            } else if (couponObj.isExpired) {
                couponObj.statusClass = 'bg-danger';
            } else if (couponObj.isExhausted) {
                couponObj.statusClass = 'bg-secondary';
            } else {
                couponObj.statusClass = 'bg-success';
            }

            // Format discount value
            couponObj.formattedDiscount = coupon.discountType === 'percentage' 
                ? `${coupon.discountValue}%` 
                : `₹${coupon.discountValue}`;

            // Format usage limits
            couponObj.formattedUsage = coupon.usageLimit 
                ? `${coupon.usageCount}/${coupon.usageLimit}`
                : `${coupon.usageCount}/∞`;

            return couponObj;
        });

        // Create pagination object
        const pagination = {
            totalPages,
            currentPage: parseInt(page),
            totalCoupons,
            hasPrevPage: page > 1,
            hasNextPage: page < totalPages
        };

        // Render the template with data
        res.render('admin/couponManagement', {
            title: 'Coupon Management',
            coupons: enhancedCoupons,
            pagination,
            query: req.query,
            filters: {
                searchQuery,
                discountType,
                status,
                validOnly
            },
            success: req.flash('success'),
            error: req.flash('error')
        });

    } catch (error) {
        console.error('Error in getCouponTemplate:', error);
        res.status(500).render('error', {
            message: 'Error loading coupon management page',
            error: process.env.NODE_ENV === 'development' ? error : {}
        });
    }
};

const getAddCoupon = async (req, res) => {
    try {
        // Fetch all active categories
        const categories = await Category.find({ isListed: true })
            .select('name categoryOffer')
            .sort({ name: 1 });

        // Fetch all active products with necessary fields
        const products = await Product.find({ isListed: true })
            .select('productName brand variants productOffer category isListed')
            .populate('category', 'name')
            .lean();

        // Group products by category with enhanced details
        const groupedProducts = products.reduce((acc, product) => {
            const categoryName = product.category?.name || 'Uncategorized';
            
            if (!acc[categoryName]) {
                acc[categoryName] = [];
            }

            // Calculate price range with any active offers
            const priceRange = calculatePriceRange(product);

            // Format variants info
            const variants = formatVariantInfo(product.variants);

            acc[categoryName].push({
                _id: product._id,
                productName: product.productName,
                brand: product.brand,
                variants: variants,
                productOffer: product.productOffer,
                isListed: product.isListed,
                priceRange: priceRange
            });

            return acc;
        }, {});

        res.render('couponAdd', {
            title: 'Add New Coupon',
            categories,
            groupedProducts,
            formData: req.flash('formData')[0],
            errors: req.flash('errors')[0]
        });
    } catch (error) {
        console.error('Error in getAddCoupon:', error);
        req.flash('error', 'Failed to load coupon form');
        res.redirect('/admin/coupons');
    }
};


// Helper function to calculate price range
const calculatePriceRange = (product) => {
    let prices = product.variants.map(variant => {
        let price = variant.price;
        // Apply product offer if exists
        if (product.productOffer > 0) {
            price = price - (price * product.productOffer / 100);
        }
        return price;
    });

    return {
        min: Math.min(...prices),
        max: Math.max(...prices)
    };
};

// Helper function to format variant information
const formatVariantInfo = (variants) => {
    return variants.map(variant => ({
        colorName: variant.colorName,
        price: variant.price
    }));
};

const addCoupon = async (req, res) => {
    try {
        const {
            code,
            description,
            discountType,
            discountValue,
            minPurchaseAmount,
            maxDiscountAmount,
            validFrom,
            validUntil,
            usageLimit,
            perUserLimit,
            applicableProducts,
            isActive
        } = req.body;

        // Validation
        const errors = {};
        
        // Validate coupon code
        if (!code || !/^[A-Za-z0-9]{1,15}$/.test(code)) {
            errors.code = { message: 'Invalid coupon code format' };
        } else {
            const existingCoupon = await Coupon.findOne({ code: code.toUpperCase() });
            if (existingCoupon) {
                errors.code = { message: 'Coupon code already exists' };
            }
        }

        // Validate discount type and value
        if (!discountType || !['percentage', 'fixed'].includes(discountType)) {
            errors.discountType = { message: 'Invalid discount type' };
        }

        if (!discountValue || isNaN(discountValue) || parseFloat(discountValue) <= 0) {
            errors.discountValue = { message: 'Invalid discount value' };
        } else if (discountType === 'percentage' && parseFloat(discountValue) > 100) {
            errors.discountValue = { message: 'Percentage discount cannot exceed 100%' };
        }

        // Validate amounts
        if (minPurchaseAmount && isNaN(minPurchaseAmount)) {
            errors.minPurchaseAmount = { message: 'Invalid minimum purchase amount' };
        }

        if (maxDiscountAmount && isNaN(maxDiscountAmount)) {
            errors.maxDiscountAmount = { message: 'Invalid maximum discount amount' };
        }

        // Validate dates
        const currentDate = new Date();
        const validFromDate = new Date(validFrom);
        const validUntilDate = new Date(validUntil);

        if (!validFrom || isNaN(validFromDate.getTime())) {
            errors.validFrom = { message: 'Invalid start date' };
        }

        if (!validUntil || isNaN(validUntilDate.getTime())) {
            errors.validUntil = { message: 'Invalid end date' };
        }

        if (validFromDate >= validUntilDate) {
            errors.validUntil = { message: 'End date must be after start date' };
        }

        // Validate usage limits
        if (usageLimit && (isNaN(usageLimit) || parseInt(usageLimit) < 1)) {
            errors.usageLimit = { message: 'Usage limit must be at least 1' };
        }

        if (perUserLimit && (isNaN(perUserLimit) || parseInt(perUserLimit) < 1)) {
            errors.perUserLimit = { message: 'Per user limit must be at least 1' };
        }

        // Validate applicable products
        if (!applicableProducts || !Array.isArray(applicableProducts) || applicableProducts.length === 0) {
            errors.applicableProducts = { message: 'At least one product must be selected' };
        }

        // If there are validation errors, return them
        if (Object.keys(errors).length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors
            });
        }

        // Create new coupon with proper type casting
        const newCoupon = new Coupon({
            code: code.toUpperCase(),
            description: description || '',
            discountType: discountType,
            discountValue: parseFloat(discountValue),
            minPurchaseAmount: minPurchaseAmount ? parseFloat(minPurchaseAmount) : 0,
            maxDiscountAmount: maxDiscountAmount ? parseFloat(maxDiscountAmount) : null,
            validFrom: validFromDate,
            validUntil: validUntilDate,
            usageLimit: usageLimit ? parseInt(usageLimit) : null,
            perUserLimit: parseInt(perUserLimit) || 1,
            applicableProducts: applicableProducts,
            isActive: isActive === 'on' || isActive === true,
            usageCount: 0
        });

        await newCoupon.save();

        res.json({
            success: true,
            message: 'Coupon created successfully',
            coupon: newCoupon
        });

    } catch (error) {
        console.error('Error in addCoupon:', error);
        
        // Handle mongoose validation errors
        if (error.name === 'ValidationError') {
            const validationErrors = {};
            for (let field in error.errors) {
                validationErrors[field] = { message: error.errors[field].message };
            }
            
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: validationErrors
            });
        }

        // Handle other errors
        res.status(500).json({
            success: false,
            message: 'Failed to create coupon',
            error: error.message
        });
    }
};

const getEditCouponPage = async (req, res) => {
    try {
        const couponId = req.params.id;

        // Fetch coupon with populated products
        const coupon = await Coupon.findById(couponId)
            .populate('applicableProducts', 'productName variants productOffer category isListed')
            .populate('applicableCategories', 'name');

        if (!coupon) {
            req.flash('error', 'Coupon not found');
            return res.redirect('/admin/coupons');
        }

        // Fetch all active categories
        const categories = await Category.find({ isListed: true })
            .select('name categoryOffer')
            .sort({ name: 1 });

        // Fetch all active products
        const products = await Product.find({ isListed: true })
            .select('productName brand variants productOffer category isListed')
            .populate('category', 'name')
            .lean();

        // Group products by category with enhanced details
        const groupedProducts = products.reduce((acc, product) => {
            const categoryName = product.category?.name || 'Uncategorized';
            
            if (!acc[categoryName]) {
                acc[categoryName] = [];
            }

            // Calculate price range
            const priceRange = {
                min: Math.min(...product.variants.map(v => v.price)),
                max: Math.max(...product.variants.map(v => v.price))
            };

            // Apply product offer if exists
            if (product.productOffer > 0) {
                priceRange.min *= (1 - product.productOffer / 100);
                priceRange.max *= (1 - product.productOffer / 100);
            }

            acc[categoryName].push({
                _id: product._id,
                productName: product.productName,
                brand: product.brand,
                variants: product.variants,
                productOffer: product.productOffer,
                isListed: product.isListed,
                priceRange: priceRange
            });

            return acc;
        }, {});

        res.render('couponEdit', {
            title: 'Edit Coupon',
            coupon,
            categories,
            groupedProducts,
            errors: req.flash('errors'),
            success: req.flash('success')
        });

    } catch (error) {
        console.error('Error in getEditCouponPage:', error);
        req.flash('error', 'Failed to load edit page');
        res.redirect('/admin/coupons');
    }
};

const updateCoupon = async (req, res) => {
    try {
        const couponId = req.params.id;
        const {
            code,
            description,
            discountType,
            discountValue,
            minPurchaseAmount,
            maxDiscountAmount,
            validFrom,
            validUntil,
            usageLimit,
            perUserLimit,
            applicableProducts,
            isActive
        } = req.body;

        // Validation
        const errors = {};
        
        // Validate coupon code
        if (!code || !/^[A-Za-z0-9]{1,15}$/.test(code)) {
            errors.code = { message: 'Invalid coupon code format' };
        } else {
            // Check if code exists (excluding current coupon)
            const existingCoupon = await Coupon.findOne({ 
                code: code.toUpperCase(),
                _id: { $ne: couponId }
            });
            if (existingCoupon) {
                errors.code = { message: 'Coupon code already exists' };
            }
        }

        // Validate discount value
        const discountVal = parseFloat(discountValue);
        if (isNaN(discountVal) || discountVal <= 0) {
            errors.discountValue = { message: 'Invalid discount value' };
        } else if (discountType === 'percentage' && discountVal > 100) {
            errors.discountValue = { message: 'Percentage cannot exceed 100%' };
        }

        // Validate dates
        const fromDate = new Date(validFrom);
        const untilDate = new Date(validUntil);
        
        if (untilDate <= fromDate) {
            errors.validUntil = { message: 'End date must be after start date' };
        }

        // Validate applicable products
        if (!applicableProducts || !Array.isArray(applicableProducts) || applicableProducts.length === 0) {
            errors.applicableProducts = { message: 'At least one product must be selected' };
        }

        // If there are validation errors, return them
        if (Object.keys(errors).length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors
            });
        }

        // Find and update the coupon
        const updatedCoupon = await Coupon.findByIdAndUpdate(
            couponId,
            {
                code: code.toUpperCase(),
                description: description || '',
                discountType,
                discountValue: discountVal,
                minPurchaseAmount: parseFloat(minPurchaseAmount) || 0,
                maxDiscountAmount: maxDiscountAmount ? parseFloat(maxDiscountAmount) : null,
                validFrom: fromDate,
                validUntil: untilDate,
                usageLimit: usageLimit ? parseInt(usageLimit) : null,
                perUserLimit: parseInt(perUserLimit) || 1,
                applicableProducts,
                isActive: isActive === 'on' || isActive === true
            },
            { new: true, runValidators: true }
        );

        if (!updatedCoupon) {
            return res.status(404).json({
                success: false,
                message: 'Coupon not found'
            });
        }

        res.json({
            success: true,
            message: 'Coupon updated successfully'
        });

    } catch (error) {
        console.error('Error in updateCoupon:', error);

        if (error.name === 'ValidationError') {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: error.errors
            });
        }

        res.status(500).json({
            success: false,
            message: 'Failed to update coupon'
        });
    }
};


const toggleCouponStatus = async (req, res) => {
    try {
        const couponId = req.params.id;

        // Find the coupon
        const coupon = await Coupon.findById(couponId);
        
        if (!coupon) {
            return res.status(404).json({
                success: false,
                message: 'Coupon not found'
            });
        }

        // Check if coupon is expired
        const now = new Date();
        const isExpired = now > new Date(coupon.validUntil);

        // Don't allow activating expired coupons
        if (!coupon.isActive && isExpired) {
            return res.status(400).json({
                success: false,
                message: 'Cannot activate expired coupon'
            });
        }

        // Check if usage limit is reached
        const isExhausted = coupon.usageLimit !== null && coupon.usageCount >= coupon.usageLimit;
        if (!coupon.isActive && isExhausted) {
            return res.status(400).json({
                success: false,
                message: 'Cannot activate coupon that has reached its usage limit'
            });
        }

        // Toggle the status
        coupon.isActive = !coupon.isActive;
        await coupon.save();

        // Send response
        res.json({
            success: true,
            message: `Coupon ${coupon.isActive ? 'activated' : 'deactivated'} successfully`,
            isActive: coupon.isActive
        });

    } catch (error) {
        console.error('Error in toggleCouponStatus:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update coupon status'
        });
    }
};

const deleteCoupon = async (req, res) => {
    try {
        const couponId = req.params.id;
        console.log('Attempting to delete coupon:', couponId); // Debug log

        const coupon = await Coupon.findById(couponId);
        
        if (!coupon) {
            console.log('Coupon not found:', couponId); // Debug log
            return res.status(404).json({
                success: false,
                message: 'Coupon not found'
            });
        }

        await Coupon.findByIdAndDelete(couponId);
        
        console.log('Coupon deleted successfully:', couponId); // Debug log
        return res.status(200).json({
            success: true,
            message: 'Coupon deleted successfully'
        });

    } catch (error) {
        console.error('Error in deleteCoupon:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to delete coupon'
        });
    }
};

module.exports = {
    getCouponTemplate,
    getAddCoupon,
    addCoupon,
    getEditCouponPage,
    updateCoupon,
    toggleCouponStatus,
    deleteCoupon
}