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
        enum: {
            values: ['percentage', 'fixed'],
            message: '{VALUE} is not a valid discount type'
        },
        required: [true, 'Discount type is required']
    },
    discountValue: {
        type: Number,
        required: [true, 'Discount value is required'],
        min: [0, 'Discount value cannot be negative'],
        validate: {
            validator: function(value) {
                if (this.discountType === 'percentage') {
                    return value <= 100;
                }
                return true;
            },
            message: 'Percentage discount cannot exceed 100%'
        }
    },
    minPurchaseAmount: {
        type: Number,
        default: 0,
        min: [0, 'Minimum purchase amount cannot be negative']
    },
    maxDiscountAmount: {
        type: Number,
        min: [0, 'Maximum discount amount cannot be negative']
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
    applicableUsers: [{
        type: Schema.Types.ObjectId,
        ref: 'User'
    }],
    applicableCategories: [{
        type: Schema.Types.ObjectId,
        ref: 'Category'
    }],
    applicableProducts: [{
        type: Schema.Types.ObjectId,
        ref: 'Product',
        required: [true, 'At least one applicable product is required']
    }],
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

const Coupon = mongoose.model('Coupon', couponSchema);
module.exports = Coupon;