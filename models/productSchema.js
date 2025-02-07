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
    slug: {
        type: String,
        unique: true,
        lowercase: true
    },
    description: {
        type: String,
        required: [true, 'Description is required'],
        trim: true,
        minlength: [10, 'Description must be at least 10 characters'],
        maxlength: [1000, 'Description cannot exceed 1000 characters']
    },
    shortDescription: {
        type: String,
        trim: true,
        maxlength: [200, 'Short description cannot exceed 200 characters']
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
    tags: [{
        type: String,
        trim: true
    }],
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
            comparePrice: {
                type: Number,
                min: [0, 'Compare price cannot be negative']
            },
            sku: {
                type: String,
                unique: true,
                sparse: true
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
    searchKeywords: [{
        type: String,
        trim: true
    }],
    isListed: {
        type: Boolean,
        default: true
    },
    ratings: {
        average: {
            type: Number,
            default: 0,
            min: 0,
            max: 5
        },
        count: {
            type: Number,
            default: 0
        }
    },
    totalSales: {
        type: Number,
        default: 0
    },
    createdOn: {
        type: Date,
        default: Date.now,
        immutable: true
    }
}, {
    timestamps: true
});

// Add compound indexes for better search performance
productSchema.index({ 
    productName: 'text',
    'variants.colorName': 'text',
    brand: 'text',
    searchKeywords: 'text',
    tags: 'text'
}, {
    weights: {
        productName: 10,
        'variants.colorName': 5,
        brand: 3,
        searchKeywords: 2,
        tags: 1
    }
});

// Index for category-based queries
productSchema.index({ category: 1, isListed: 1 });

// Generate slug before saving
productSchema.pre('save', function(next) {
    if (this.isModified('productName')) {
        this.slug = slugify(this.productName, {
            lower: true,
            strict: true
        });
    }
    next();
});

// Virtual for calculating total stock across all variants
productSchema.virtual('totalStock').get(function() {
    return this.variants.reduce((total, variant) => {
        return total + variant.colorVariant.reduce((variantTotal, size) => {
            return variantTotal + size.stock;
        }, 0);
    }, 0);
});

// Virtual for minimum and maximum prices
productSchema.virtual('priceRange').get(function() {
    let min = Infinity;
    let max = -Infinity;

    this.variants.forEach(variant => {
        variant.colorVariant.forEach(size => {
            const finalPrice = size.price * (1 - (this.productOffer / 100));
            min = Math.min(min, finalPrice);
            max = Math.max(max, finalPrice);
        });
    });

    return {
        min: min === Infinity ? 0 : min,
        max: max === -Infinity ? 0 : max
    };
});

// Method to check if a specific variant and size is available
productSchema.methods.isAvailable = function(colorName, size) {
    const variant = this.variants.find(v => v.colorName === colorName);
    if (!variant) return false;
    
    const sizeVariant = variant.colorVariant.find(sv => sv.size === size);
    return sizeVariant ? sizeVariant.stock > 0 && sizeVariant.status === 'available' : false;
};

// Method to get final price after applying offers
productSchema.methods.getFinalPrice = function(colorName, size) {
    const variant = this.variants.find(v => v.colorName === colorName);
    if (!variant) return null;
    
    const sizeVariant = variant.colorVariant.find(sv => sv.size === size);
    if (!sizeVariant) return null;

    return sizeVariant.price * (1 - (this.productOffer / 100));
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