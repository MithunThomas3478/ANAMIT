const Product = require('../../models/productSchema');
const Category = require('../../models/categorySchema');
const Cart = require('../../models/cartSchema');

const getCart = async (req, res) => {
    try {
        // Find cart for current user and populate product details
        const cart = await Cart.findOne({ 
            user: req.user._id, 
            active: true 
        }).populate({
            path: 'items.product',
            select: 'productName variants'
        });

        if (!cart) {
            return res.render('shoppingCart', {
                cart: {
                    items: [],
                    totalPrice: 0
                }
            });
        }

        // Format cart data for the template
        const formattedCart = {
            items: cart.items.map(item => ({
                productId: item.product._id,
                product: {
                    productName: item.product.productName,
                    variants: item.product.variants
                },
                colorName: item.selectedColor.colorName,
                size: item.selectedSize,
                quantity: item.quantity,
                price: item.price,
                total: item.price * item.quantity
            })),
            totalPrice: cart.totalAmount - cart.totalDiscount
        };

        res.render('shoppingCart', { cart: formattedCart });

    } catch (error) {
        console.error('Error fetching cart:', error);
        res.status(500).render('error', { 
            message: 'Failed to load cart. Please try again.' 
        });
    }
}



const updateQuantity = async (req, res) => {
    try {
        const userId = req.user._id;
        const { productId, quantity } = req.body;
        const newQuantity = parseInt(quantity);

        // Check maximum quantity limit
        if (newQuantity > 5) {
            return res.status(400).json({
                success: false,
                message: 'Maximum quantity allowed is 5 items'
            });
        }

        // First, get the current cart item to get color and size
        const cart = await Cart.findOne({
            user: userId,
            active: true,
            'items.product': productId
        }).populate('items.product');

        const cartItem = cart.items.find(item => 
            item.product._id.toString() === productId
        );

        if (!cartItem) {
            return res.status(404).json({
                success: false,
                message: 'Item not found in cart'
            });
        }

        // Find the specific variant and check stock
        const variant = cartItem.product.variants.find(
            v => v.colorName === cartItem.selectedColor.colorName
        );
        
        const sizeVariant = variant?.colorVariant.find(
            sv => sv.size === cartItem.selectedSize
        );

        if (!sizeVariant) {
            return res.status(400).json({
                success: false,
                message: 'Product variant not found'
            });
        }

        // Check if requested quantity is available
        if (newQuantity > sizeVariant.stock) {
            return res.status(400).json({
                success: false,
                message: `Only ${sizeVariant.stock} items available in stock`
            });
        }

        // Update cart quantity if stock is available
        const result = await Cart.updateOne(
            {
                user: userId,
                active: true,
                'items.product': productId
            },
            {
                $set: {
                    'items.$.quantity': newQuantity
                }
            }
        );

        if (result.modifiedCount === 0) {
            return res.status(404).json({
                success: false,
                message: 'Failed to update cart'
            });
        }

        // Fetch updated cart
        const updatedCart = await Cart.findOne({
            user: userId,
            active: true
        }).populate('items.product');

        // Format and return response
        const formattedCart = {
            items: updatedCart.items.map(item => ({
                productId: item.product._id.toString(),
                quantity: item.quantity,
                price: item.price,
                total: item.price * item.quantity,
                product: {
                    productName: item.product.productName,
                    variants: item.product.variants
                },
                colorName: item.selectedColor.colorName,
                size: item.selectedSize
            })),
            totalPrice: updatedCart.totalAmount - updatedCart.totalDiscount
        };

        res.json({
            success: true,
            cart: formattedCart,
            message: 'Cart updated successfully'
        });

    } catch (error) {
        console.error('Error updating cart quantity:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update quantity',
            error: error.message
        });
    }
};



const removeProduct = async (req, res) => {
    try {
        const userId = req.user._id;
        const { productId } = req.body;

        // Find and update cart by removing the specific item
        const result = await Cart.updateOne(
            { 
                user: userId,
                active: true 
            },
            {
                $pull: {
                    items: {
                        product: productId  
                    }
                }
            }
        );

        if (result.modifiedCount === 0) {
            return res.status(404).json({
                success: false,
                message: 'Product not found in cart'
            });
        }

        // Fetch updated cart to return latest data
        const updatedCart = await Cart.findOne({
            user: userId,
            active: true
        }).populate({
            path: 'items.product',
            select: 'productName variants'
        });

        // Recalculate totals after removing item
        updatedCart.totalAmount = updatedCart.items.reduce((total, item) => total + (item.price * item.quantity), 0);
        updatedCart.totalDiscount = updatedCart.items.reduce((total, item) => {
            const itemTotal = item.price * item.quantity;
            const productDiscount = (itemTotal * item.appliedProductOffer) / 100;
            const categoryDiscount = (itemTotal * item.appliedCategoryOffer) / 100;
            return total + productDiscount + categoryDiscount;
        }, 0);

        await updatedCart.save(); // Save the recalculated totals

        // Format cart data consistent with your existing pattern
        const formattedCart = {
            items: updatedCart.items.map(item => ({
                productId: item.product._id,
                product: {
                    productName: item.product.productName,
                    variants: item.product.variants
                },
                colorName: item.selectedColor.colorName,
                size: item.selectedSize,
                quantity: item.quantity,
                price: item.price,
                total: item.price * item.quantity
            })),
            totalPrice: updatedCart.totalAmount - updatedCart.totalDiscount
        };

        res.json({
            success: true,
            cart: formattedCart,
            message: 'Product removed from cart successfully'
        });

    } catch (error) {
        console.error('Error removing product from cart:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to remove product from cart',
            error: error.message
        });
    }
};


module.exports ={
getCart,
updateQuantity,
removeProduct

}