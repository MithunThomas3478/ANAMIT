const Product = require('../../models/productSchema');
const Category = require('../../models/categorySchema');
const Cart = require('../../models/cartSchema');
const Offer = require('../../models/offerSchema');

const getCart = async (req, res) => {
    try {
        const currentDate = new Date();
        
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

        const activeOffers = await Offer.find({
            isActive: true,
            startDate: { $lte: currentDate },
            endDate: { $gte: currentDate }
        }).lean();

        const formattedCart = {
            items: cart.items.map(item => ({
                productId: item.product._id,
                colorName: item.selectedColor.colorName,
                colorValue: item.selectedColor.colorValue,
                size: item.selectedSize,
                quantity: item.quantity,
                price: item.price,
                appliedProductOffer: item.appliedProductOffer,
                appliedCategoryOffer: item.appliedCategoryOffer,
                product: {
                    productName: item.product.productName,
                    variants: item.product.variants,
                    category: item.product.category.name
                }
            })),
            totalAmount: cart.totalAmount,
            totalDiscount: cart.totalDiscount
        };

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

        if (isNaN(newQuantity) || newQuantity < 1) {
            return res.status(400).json({
                success: false,
                message: 'Invalid quantity'
            });
        }

        if (newQuantity > 5) {
            return res.status(400).json({
                success: false,
                message: 'Maximum quantity allowed is 5 items'
            });
        }

        const cart = await Cart.findOne({
            user: userId,
            active: true
        }).populate({
            path: 'items.product',
            select: 'productName variants category',
            populate: {
                path: 'category',
                select: 'name'
            }
        });

        if (!cart) {
            return res.status(404).json({
                success: false,
                message: 'Cart not found'
            });
        }

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

        const variant = cartItem.product.variants.find(v => v.colorName === colorName);
        const sizeVariant = variant?.colorVariant.find(sv => sv.size === size);

        if (!sizeVariant || newQuantity > sizeVariant.stock) {
            return res.status(400).json({
                success: false,
                message: `Only ${sizeVariant?.stock || 0} items available`
            });
        }

        cartItem.quantity = newQuantity;

        let totalAmount = 0;
        let totalDiscount = 0;

        cart.items.forEach(item => {
            const itemTotal = item.price * item.quantity;
            totalAmount += itemTotal;
            totalDiscount += (itemTotal * (item.appliedProductOffer + item.appliedCategoryOffer)) / 100;
        });

        cart.totalAmount = totalAmount;
        cart.totalDiscount = totalDiscount;

        await cart.save();

        const formattedCart = {
            items: cart.items.map(item => ({
                productId: item.product._id.toString(),
                product: {
                    productName: item.product.productName,
                    variants: item.product.variants
                },
                colorName: item.selectedColor.colorName,
                size: item.selectedSize,
                quantity: item.quantity,
                price: item.price,
                appliedProductOffer: item.appliedProductOffer,
                appliedCategoryOffer: item.appliedCategoryOffer,
                total: item.price * item.quantity
            })),
            totalAmount,
            totalDiscount,
            finalAmount: totalAmount - totalDiscount
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

        const cart = await Cart.findOne({ 
            user: userId,
            active: true 
        });

        if (!cart) {
            return res.status(404).json({
                success: false,
                message: 'Cart not found'
            });
        }

        cart.items = cart.items.filter(item => 
            !(item.product.toString() === productId &&
              item.selectedColor.colorName === colorName &&
              item.selectedSize === size)
        );

        let totalAmount = 0;
        let totalDiscount = 0;

        cart.items.forEach(item => {
            const itemTotal = item.price * item.quantity;
            totalAmount += itemTotal;
            totalDiscount += (itemTotal * (item.appliedProductOffer + item.appliedCategoryOffer)) / 100;
        });

        cart.totalAmount = totalAmount;
        cart.totalDiscount = totalDiscount;

        await cart.save();

        const updatedCart = await Cart.findById(cart._id).populate({
            path: 'items.product',
            select: 'productName variants'
        });

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
                appliedProductOffer: item.appliedProductOffer,
                appliedCategoryOffer: item.appliedCategoryOffer,
                total: item.price * item.quantity
            })),
            totalAmount,
            totalDiscount,
            finalAmount: totalAmount - totalDiscount
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
            message: 'Failed to remove product from cart'
        });
    }
};

module.exports = {
    getCart,
    updateQuantity,
    removeProduct
};