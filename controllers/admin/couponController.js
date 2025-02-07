const Coupon = require('../../models/couponSchema');
const User = require('../../models/userSchema');
const Category = require('../../models/categorySchema');
const Product = require('../../models/productSchema');

const getCouponTemplate = async (req, res) => {
    try {
        // Get query parameters for filtering and pagination
        const { 
            search,          // Changed from searchQuery to match template
            status,
            validOnly,
            page = 1        // Default to first page
        } = req.query;

        const limit = 10;    // Items per page
        const skip = (page - 1) * limit;

        // Build filter object
        let filter = {};
        
        // Search filter
        if (search) {       // Changed from searchQuery to search
            filter.$or = [
                { code: new RegExp(search, 'i') },
                { description: new RegExp(search, 'i') }
            ];
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
                couponObj.statusClass = 'badge-inactive';
            } else if (couponObj.isExpired) {
                couponObj.statusClass = 'badge-expired';
            } else if (couponObj.isExhausted) {
                couponObj.statusClass = 'badge-inactive';
            } else {
                couponObj.statusClass = 'badge-active';
            }
            // No need for formattedDiscount since it's always percentage
            couponObj.minPurchaseAmount = couponObj.minPurchaseAmount || 0;
            couponObj.maxDiscountAmount = couponObj.maxDiscountAmount || 0;
            couponObj.discountValue = couponObj.discountValue || 0;
            couponObj.usageCount = couponObj.usageCount || 0;
        
            // Format usage information
            if (coupon.usageLimit) {
                couponObj.formattedUsage = `${couponObj.usageCount}/${coupon.usageLimit}`;
            } else {
                couponObj.formattedUsage = `${couponObj.usageCount}/∞`;
            }
        
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
        res.render('couponManagement', {
            title: 'Coupon Management',
            coupons: enhancedCoupons,
            pagination,
            filters: {
                search,          // Changed from searchQuery to search
                status,
                validOnly
            },
            successMessage: req.flash('success'),    // Changed to match template
            errorMessage: req.flash('error')         // Changed to match template
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
        // Get any flash messages for errors or previously entered form data
        const formData = req.flash('formData')[0] || {};
        const errors = req.flash('errors')[0] || {};

        // Set default values for dates
        const currentDate = new Date();
        const defaultValidFrom = currentDate.toISOString().slice(0, 16); // Format: YYYY-MM-DDTHH:mm
        
        // Set default end date to 30 days from now
        const defaultValidUntil = new Date(currentDate);
        defaultValidUntil.setDate(defaultValidUntil.getDate() + 30);
        const defaultValidUntilStr = defaultValidUntil.toISOString().slice(0, 16);

        // Prepare initial form data with defaults
        const initialFormData = {
            code: '',
            description: '',
            discountValue: '',
            minPurchaseAmount: '',
            maxDiscountAmount: '',
            validFrom: defaultValidFrom,
            validUntil: defaultValidUntilStr,
            usageLimit: '',
            perUserLimit: 1,
            isActive: true,
            ...formData // Override defaults with any flashed form data
        };

        res.render('admin/couponAdd', {
            title: 'Add New Coupon',
            formData: initialFormData,
            errors: errors,
            defaultValidFrom,
            defaultValidUntil: defaultValidUntilStr,
            // Add validation constants that might be useful in the view
            validationRules: {
                maxDiscountPercentage: 90,
                minDiscountPercentage: 0,
                codePattern: '^[A-Z0-9]{1,15}$',
                maxDescriptionLength: 200
            },
            // Add any success or error messages from flash
            messages: {
                success: req.flash('success'),
                error: req.flash('error')
            }
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
            discountValue,
            minPurchaseAmount,
            maxDiscountAmount,
            validFrom,
            validUntil,
            usageLimit,
            perUserLimit,
            isActive
        } = req.body;

        // Validation
        const errors = {};
        
        // Validate coupon code
        if (!code || !/^[A-Z0-9]{1,15}$/.test(code)) {
            errors.code = { message: 'Invalid coupon code format' };
        } else {
            const existingCoupon = await Coupon.findOne({ code: code.toUpperCase() });
            if (existingCoupon) {
                errors.code = { message: 'Coupon code already exists' };
            }
        }

        // Validate discount value
        const discountNum = parseFloat(discountValue);
        if (!discountValue || isNaN(discountNum) || discountNum < 0 || discountNum > 90) {
            errors.discountValue = { message: 'Discount must be between 0 and 90%' };
        }

        // Validate amounts
        const minPurchase = parseFloat(minPurchaseAmount);
        const maxDiscount = parseFloat(maxDiscountAmount);

        if (!minPurchaseAmount || isNaN(minPurchase) || minPurchase < 1) {
            errors.minPurchaseAmount = { message: 'Minimum purchase amount must be at least 1' };
        }

        if (!maxDiscountAmount || isNaN(maxDiscount) || maxDiscount < 1) {
            errors.maxDiscountAmount = { message: 'Maximum discount amount must be at least 1' };
        }

        if (maxDiscount >= minPurchase) {
            errors.maxDiscountAmount = { message: 'Maximum discount must be less than minimum purchase amount' };
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

        if (validFromDate < currentDate) {
            errors.validFrom = { message: 'Start date cannot be in the past' };
        }

        // Validate usage limits
        if (usageLimit && (isNaN(usageLimit) || parseInt(usageLimit) < 1)) {
            errors.usageLimit = { message: 'Usage limit must be at least 1' };
        }

        if (!perUserLimit || isNaN(perUserLimit) || parseInt(perUserLimit) < 1) {
            errors.perUserLimit = { message: 'Per user limit must be at least 1' };
        }

        // If there are validation errors, return them
        if (Object.keys(errors).length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors
            });
        }

        // Create new coupon
        const newCoupon = new Coupon({
            code: code.toUpperCase(),
            description: description || '',
            discountValue: discountNum,
            minPurchaseAmount: minPurchase,
            maxDiscountAmount: maxDiscount,
            validFrom: validFromDate,
            validUntil: validUntilDate,
            usageLimit: usageLimit ? parseInt(usageLimit) : null,
            perUserLimit: parseInt(perUserLimit),
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

        // Fetch coupon with lean() for better performance
        const coupon = await Coupon.findById(couponId).lean();

        if (!coupon) {
            req.flash('error', 'Coupon not found');
            return res.redirect('/admin/coupons');
        }

        // Prepare validation constraints from schema
        const validationRules = {
            maxDiscountPercentage: 90,
            minDiscountPercentage: 0,
            codePattern: '^[A-Z0-9]{1,15}$',
            maxDescriptionLength: 200,
            minimumPurchaseAmount: 1,
            minimumDiscountAmount: 1
        };

        // Format dates for datetime-local inputs
        const formattedDates = {
            validFrom: new Date(coupon.validFrom).toISOString().slice(0, 16),
            validUntil: new Date(coupon.validUntil).toISOString().slice(0, 16)
        };

        res.render('couponEdit', {
            title: 'Edit Coupon',
            coupon,
            formattedDates,
            validationRules,
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
            discountValue,
            minPurchaseAmount,
            maxDiscountAmount,
            validFrom,
            validUntil,
            usageLimit,
            perUserLimit,
            isActive
        } = req.body;

        // Validation
        const errors = {};

        // Validate coupon code
        if (!code || !/^[A-Z0-9]{1,15}$/.test(code.toUpperCase())) {
            errors.code = 'Invalid coupon code format';
        } else {
            // Check if code exists (excluding current coupon)
            const existingCoupon = await Coupon.findOne({
                code: code.toUpperCase(),
                _id: { $ne: couponId }
            });
            if (existingCoupon) {
                errors.code = 'Coupon code already exists';
            }
        }

        // Validate dates
        const fromDate = new Date(validFrom);
        const untilDate = new Date(validUntil);
        
        if (untilDate <= fromDate) {
            errors.validUntil = 'End date must be after start date';
        }

        // Check discount and amount validations
        const discountVal = parseFloat(discountValue);
        const minPurchase = parseFloat(minPurchaseAmount);
        const maxDiscount = parseFloat(maxDiscountAmount);

        if (isNaN(discountVal) || discountVal < 0 || discountVal > 90) {
            errors.discountValue = 'Discount must be between 0 and 90%';
        }

        if (isNaN(minPurchase) || minPurchase < 1) {
            errors.minPurchaseAmount = 'Minimum purchase amount must be at least 1';
        }

        if (isNaN(maxDiscount) || maxDiscount < 1) {
            errors.maxDiscountAmount = 'Maximum discount amount must be at least 1';
        }

        if (maxDiscount >= minPurchase) {
            errors.maxDiscountAmount = 'Maximum discount must be less than minimum purchase amount';
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
                discountValue: discountVal,
                minPurchaseAmount: minPurchase,
                maxDiscountAmount: maxDiscount,
                validFrom: fromDate,
                validUntil: untilDate,
                usageLimit: usageLimit ? parseInt(usageLimit) : null,
                perUserLimit: parseInt(perUserLimit) || 1,
                isActive: isActive === 'on' || isActive === true
            },
            { 
                new: true, 
                runValidators: true,
                context: 'query' 
            }
        );

        if (!updatedCoupon) {
            return res.status(404).json({
                success: false,
                message: 'Coupon not found'
            });
        }

        res.json({
            success: true,
            message: 'Coupon updated successfully',
            coupon: updatedCoupon
        });

    } catch (error) {
        console.error('Error in updateCoupon:', error);
        
        if (error.name === 'ValidationError') {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: Object.fromEntries(
                    Object.entries(error.errors).map(([key, value]) => [key, value.message])
                )
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