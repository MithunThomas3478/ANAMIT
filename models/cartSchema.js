const mongoose = require('mongoose');
const { Schema } = mongoose;

const cartSchema = new Schema({
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: [true, 'User ID is required']
    },
    items: [{
        productId: {
            type: Schema.Types.ObjectId,
            ref: 'Product',
            required: [true, 'Product ID is required']
        },
        colorName: {
            type: String,
            required: [true, 'Color name is required']
        },
        size: {
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
            min: [1, 'Quantity must be at least 1']
        },
        price: {
            type: Number,
            required: [true, 'Price is required'],
            min: [0, 'Price cannot be negative']
        },
        total: {
            type: Number,
            required: true,
            min: [0, 'Total cannot be negative']
        }
    }],
    totalPrice: {
        type: Number,
        required: true,
        default: 0,
        min: [0, 'Total price cannot be negative']
    },
    createdOn: {
        type: Date,
        default: Date.now,
        immutable: true
    }
}, {
    timestamps: true
});

// Middleware to calculate total price for the cart
cartSchema.pre('save', function(next) {
    this.totalPrice = this.items.reduce((sum, item) => sum + item.total, 0);
    next();
});

// Method to add an item to the cart
cartSchema.methods.addItem = function(productId, colorName, size, quantity, price) {
    const itemIndex = this.items.findIndex(
        item => item.productId.equals(productId) && item.colorName === colorName && item.size === size
    );

    if (itemIndex > -1) {
        // If item exists, update the quantity and total
        this.items[itemIndex].quantity += quantity;
        this.items[itemIndex].total = this.items[itemIndex].quantity * price;
    } else {
        // If item does not exist, add a new one
        this.items.push({
            productId,
            colorName,
            size,
            quantity,
            price,
            total: quantity * price
        });
    }

    // Recalculate total price
    this.totalPrice = this.items.reduce((sum, item) => sum + item.total, 0);
};

const Cart = mongoose.model('Cart', cartSchema);
module.exports = Cart;
