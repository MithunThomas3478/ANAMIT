const Product = require('../../models/productSchema');
const Category = require('../../models/categorySchema');
const Cart = require('../../models/cartSchema');
const Offer = require('../../models/offerSchema');

const getCart = async (req, res) => {
    try {
        const currentDate = new Date();
        
        // Find cart and populate product details
        const cart = await Cart.findOne({ 
            user: req.user._id, 
            active: true 
        }).populate([{
            path: 'items.product',
            select: 'productName variants category',
            populate: {
                path: 'category',
                select: 'name'
            }
        }]);

        if (!cart) {
            return res.render('shoppingCart', {
                cart: {
                    items: [],
                    totalAmount: 0,
                    totalDiscount: 0
                }
            });
        }

        // Get all active offers that might apply to cart items
        const activeOffers = await Offer.find({
            isActive: true,
            startDate: { $lte: currentDate },
            endDate: { $gte: currentDate }
        }).lean();

        // Format cart data and apply current offers
        const formattedCart = {
            items: await Promise.all(cart.items.map(async (item) => {
                // Find applicable offers
                const productOffer = activeOffers.find(
                    offer => offer.offerType === 'product' && 
                    offer.product?.toString() === item.product._id.toString()
                );

                const categoryOffer = activeOffers.find(
                    offer => offer.offerType === 'category' && 
                    offer.category?.toString() === item.product.category._id.toString()
                );

                // Calculate best discount
                const productDiscount = productOffer?.discountPercentage || 0;
                const categoryDiscount = categoryOffer?.discountPercentage || 0;

                // Update item with current offer information
                item.appliedProductOffer = productDiscount;
                item.appliedCategoryOffer = categoryDiscount;

                // Calculate final price with current offers
                const discountPercentage = productDiscount + categoryDiscount;
                const finalPrice = item.price * (1 - discountPercentage/100);

                return {
                    productId: item.product._id,
                    product: {
                        productName: item.product.productName,
                        variants: item.product.variants,
                        category: item.product.category.name
                    },
                    colorName: item.selectedColor.colorName,
                    size: item.selectedSize,
                    quantity: item.quantity,
                    price: item.price,
                    appliedProductOffer: productDiscount,
                    appliedCategoryOffer: categoryDiscount,
                    total: finalPrice * item.quantity
                };
            })),
            totalAmount: cart.totalAmount,
            totalDiscount: cart.totalDiscount
        };

        // Save updated offers
        await cart.save();

        res.render('shoppingCart', { cart: formattedCart });

    } catch (error) {
        console.error('Error fetching cart:', error);
        res.status(500).render('error', { 
            message: 'Failed to load cart. Please try again.' 
        });
    }
};


const updateQuantity = async (req, res) => {
    try {
        const userId = req.user._id;
        const { productId, colorName, size, quantity } = req.body;
        const newQuantity = parseInt(quantity);

        if (newQuantity > 5) {
            return res.status(400).json({
                success: false,
                message: 'Maximum quantity allowed is 5 items'
            });
        }

        // Get cart first
        const cart = await Cart.findOne({
            user: userId,
            active: true
        }).populate('items.product');

        if (!cart) {
            return res.status(404).json({
                success: false,
                message: 'Cart not found'
            });
        }

        // Find specific item
        const cartItem = cart.items.find(item => 
            item.product._id.toString() === productId &&
            item.selectedColor.colorName === colorName &&
            item.selectedSize === size
        );

        if (!cartItem) {
            return res.status(404).json({
                success: false,
                message: 'Item not found in cart'
            });
        }

        // Check stock
        const variant = cartItem.product.variants.find(v => v.colorName === colorName);
        const sizeVariant = variant?.colorVariant.find(sv => sv.size === size);

        if (!sizeVariant || newQuantity > sizeVariant.stock) {
            return res.status(400).json({
                success: false,
                message: `Only ${sizeVariant?.stock || 0} items available`
            });
        }

        // Update quantity
        await Cart.updateOne(
            {
                user: userId,
                active: true,
                "items": {
                    $elemMatch: {
                        product: productId,
                        "selectedColor.colorName": colorName,
                        selectedSize: size
                    }
                }
            },
            {
                $set: { "items.$.quantity": newQuantity }
            }
        );

        // Get updated cart
        const updatedCart = await Cart.findOne({
            user: userId,
            active: true
        }).populate('items.product');

        // Calculate new totals
        let totalAmount = 0;
        let totalDiscount = 0;

        updatedCart.items.forEach(item => {
            const itemTotal = item.price * item.quantity;
            totalAmount += itemTotal;
            totalDiscount += (itemTotal * (item.appliedProductOffer + item.appliedCategoryOffer)) / 100;
        });

        updatedCart.totalAmount = totalAmount;
        updatedCart.totalDiscount = totalDiscount;
        await updatedCart.save();

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
            totalPrice: totalAmount - totalDiscount
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
            message: 'Failed to update quantity'
        });
    }
};


const removeProduct = async (req, res) => {
    try {
        const userId = req.user._id;
        const { productId, colorName, size } = req.body;

        // Find and update cart by removing the specific variant
        const result = await Cart.updateOne(
            { 
                user: userId,
                active: true 
            },
            {
                $pull: {
                    items: {
                        product: productId,
                        'selectedColor.colorName': colorName,
                        selectedSize: size
                    }
                }
            }
        );

        if (result.modifiedCount === 0) {
            return res.status(404).json({
                success: false,
                message: 'Product variant not found in cart'
            });
        }

        // Fetch and update cart as before
        const updatedCart = await Cart.findOne({
            user: userId,
            active: true
        }).populate({
            path: 'items.product',
            select: 'productName variants'
        });

        // Recalculate totals
        updatedCart.totalAmount = updatedCart.items.reduce((total, item) => 
            total + (item.price * item.quantity), 0);
        updatedCart.totalDiscount = updatedCart.items.reduce((total, item) => {
            const itemTotal = item.price * item.quantity;
            return total + 
                (itemTotal * item.appliedProductOffer / 100) + 
                (itemTotal * item.appliedCategoryOffer / 100);
        }, 0);

        await updatedCart.save();

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
            message: 'Product variant removed from cart successfully'
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