const mongoose = require('mongoose');
const { Schema } = mongoose;

const couponSchema = new Schema({
    code: {
        type: String,
        required: [true, 'Coupon code is required'],
        trim: true,
        unique: true,
        uppercase: true,
        match: [/^[A-Z0-9]{1,15}$/, 'Coupon code must be 1-15 alphanumeric characters'],
        index: true
    },
    description: {
        type: String,
        trim: true,
        maxLength: [200, 'Description cannot exceed 200 characters']
    },
    discountType: {
        type: String,
        enum: ['percentage', 'fixed'],
        default: 'percentage',
        required: true
    },
    discountValue: {
        type: Number,
        required: [true, 'Discount value is required'],
        min: [0, 'Discount value cannot be negative'],
        validate: {
            validator: function(value) {
                if (this.discountType === 'percentage') {
                    return value <= 90;
                }
                return true;
            },
            message: 'Percentage discount cannot exceed 90%'
        }
    },
    minPurchaseAmount: {
        type: Number,
        required: [true, 'Minimum purchase amount is required'],
        min: [1, 'Minimum purchase amount must be at least 1']
    },
    maxDiscountAmount: {
        type: Number,
        required: [true, 'Maximum discount amount is required'],
        min: [1, 'Maximum discount amount must be at least 1']
    },
    validFrom: {
        type: Date,
        required: [true, 'Start date is required']
    },
    validUntil: {
        type: Date,
        required: [true, 'End date is required']
    },
    usageLimit: {
        type: Number,
        default: null,
        min: [1, 'Usage limit must be at least 1']
    },
    usageCount: {
        type: Number,
        default: 0
    },
    perUserLimit: {
        type: Number,
        default: 1,
        min: [1, 'Per-user limit must be at least 1']
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true
});

// Index for efficient querying
couponSchema.index({ 
    isActive: 1, 
    validFrom: 1, 
    validUntil: 1,
    code: 1
});

// Add validation to ensure maxDiscountAmount is less than minPurchaseAmount
couponSchema.pre('save', function(next) {
    if (this.maxDiscountAmount >= this.minPurchaseAmount) {
        next(new Error('Maximum discount amount must be less than minimum purchase amount'));
    }
    next();
});

const Coupon = mongoose.model('Coupon', couponSchema);
module.exports = Coupon;