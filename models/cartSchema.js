const mongoose = require('mongoose');
const { Schema } = mongoose;

const cartItemSchema = new Schema({
    product: {
        type: Schema.Types.ObjectId,
        ref: 'Product',
        required: [true, 'Product reference is required']
    },
    selectedColor: {
        colorName: {
            type: String,
            required: [true, 'Color name is required']
        },
        colorValue: {
            type: String,
            required: [true, 'Color value is required']
        }
    },
    selectedSize: {
        type: String,
        required: [true, 'Size is required'],
        enum: {
            values: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
            message: '{VALUE} is not a valid size'
        }
    },
    quantity: {
        type: Number,
        required: [true, 'Quantity is required'],
        min: [1, 'Quantity must be at least 1'],
        validate: {
            validator: Number.isInteger,
            message: 'Quantity must be a whole number'
        }
    },
    price: {
        type: Number,
        required: [true, 'Price is required'],
        min: [0, 'Price cannot be negative']
    },
    // Store the applied offers at the time of adding to cart
    appliedProductOffer: {
        type: Number,
        default: 0,
        min: [0, 'Product offer cannot be negative'],
        max: [100, 'Product offer cannot exceed 100%']
    },
    appliedCategoryOffer: {
        type: Number,
        default: 0,
        min: [0, 'Category offer cannot be negative'],
        max: [100, 'Category offer cannot exceed 100%']
    }
});

const cartSchema = new Schema({
    user: {
        type: Schema.Types.ObjectId,
        ref: 'User',  // Assuming you have a User model
        required: [true, 'User reference is required']
    },
    items: [cartItemSchema],
    totalAmount: {
        type: Number,
        default: 0
    },
    totalDiscount: {
        type: Number,
        default: 0
    },
    active: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true
});

// Virtual for calculating total items in cart
cartSchema.virtual('totalItems').get(function() {
    return this.items.reduce((total, item) => total + item.quantity, 0);
});

// Method to check if product is available before adding to cart
cartSchema.methods.checkProductAvailability = async function(productId, colorName, size, quantity) {
    const Product = mongoose.model('Product');
    const product = await Product.findById(productId);
    
    if (!product) return false;
    
    const variant = product.variants.find(v => v.colorName === colorName);
    if (!variant) return false;
    
    const sizeVariant = variant.colorVariant.find(sv => sv.size === size);
    if (!sizeVariant) return false;
    
    return sizeVariant.stock >= quantity && sizeVariant.status === 'available';
};

// Calculate totals before saving
cartSchema.pre('save', function(next) {
    // Calculate total amount and discount
    let totalAmount = 0;
    let totalDiscount = 0;
    
    this.items.forEach(item => {
        const itemTotal = item.price * item.quantity;
        const productDiscount = (itemTotal * item.appliedProductOffer) / 100;
        const categoryDiscount = (itemTotal * item.appliedCategoryOffer) / 100;
        
        totalAmount += itemTotal;
        totalDiscount += (productDiscount + categoryDiscount);
    });
    
    this.totalAmount = totalAmount;
    this.totalDiscount = totalDiscount;
    
    next();
});

const Cart = mongoose.model('Cart', cartSchema);
module.exports = Cart;