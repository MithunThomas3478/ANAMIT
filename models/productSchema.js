const mongoose = require('mongoose');
const { Schema } = mongoose;

const productSchema = new Schema({
    productName: {
        type: String,
        required: [true, 'Product name is required'],
        trim: true,
        minlength: [2, 'Product name must be at least 2 characters'],
        maxlength: [100, 'Product name cannot exceed 100 characters']
    },
    description: {
        type: String,
        required: [true, 'Description is required'],
        trim: true,
        minlength: [10, 'Description must be at least 10 characters'],
        maxlength: [1000, 'Description cannot exceed 1000 characters']
    },
    category: {
        type: Schema.Types.ObjectId,
        ref: 'Category',
        required: [true, 'Category is required']
    },
    productOffer: {
        type: Number,
        default: 0,
        min: [0, 'Offer cannot be negative'],
        max: [100, 'Offer cannot exceed 100%']
    },
    variants: [{
        colorValue: {
            type: String,
            required: [true, 'Color value is required'],
            trim: true
        },
        colorName: {
            type: String,
            required: [true, 'Color name is required'],
            trim: true
        },
        colorVariant: [{
            size: {
                type: String,
                required: [true, 'Size is required'],
                trim: true,
                enum: {
                    values: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
                    message: '{VALUE} is not a valid size'
                }
            },
            stock: {
                type: Number,
                required: [true, 'Stock is required'],
                min: [0, 'Stock cannot be negative']
            },
            price: {
                type: Number,
                required: [true, 'Price is required'],
                min: [0, 'Price cannot be negative']
            },
            status: {
                type: String,
                required: [true, 'Status is required'],
                enum: {
                    values: ['available', 'out of stock', 'discontinued'],
                    message: '{VALUE} is not a valid status'
                },
                default: 'available'
            }
        }],
        productImage: {
            type: [String],
            required: [true, 'At least one product image is required'],
            validate: {
                validator: function(array) {
                    return array.length > 0;
                },
                message: 'At least one product image is required'
            }
        }
    }],
    isListed: {
        type: Boolean,
        default: true
    },
    createdOn: {
        type: Date,
        default: Date.now,
        immutable: true
    }
}, {
    timestamps: true
});

// Add index for better search performance
productSchema.index({ productName: 'text', 'variants.colorName': 'text' });

// Virtual for calculating total stock across all variants
productSchema.virtual('totalStock').get(function() {
    return this.variants.reduce((total, variant) => {
        return total + variant.colorVariant.reduce((variantTotal, size) => {
            return variantTotal + size.stock;
        }, 0);
    }, 0);
});

// Method to check if a specific variant and size is available
productSchema.methods.isAvailable = function(colorName, size) {
    const variant = this.variants.find(v => v.colorName === colorName);
    if (!variant) return false;
    
    const sizeVariant = variant.colorVariant.find(sv => sv.size === size);
    return sizeVariant ? sizeVariant.stock > 0 && sizeVariant.status === 'available' : false;
};

// Middleware to ensure unique size per color variant
productSchema.pre('save', function(next) {
    this.variants.forEach(variant => {
        const sizes = variant.colorVariant.map(sv => sv.size);
        const uniqueSizes = new Set(sizes);
        if (sizes.length !== uniqueSizes.size) {
            next(new Error('Duplicate sizes found in color variant'));
        }
    });
    next();
});

const Product = mongoose.model('Product', productSchema);
module.exports = Product;