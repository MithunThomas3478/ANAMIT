const Cart = require('../../models/cartSchema');
const orderSchema = require('../../models/orderSchema');
const Address = require('../../models/addressSchema')
// controllers/checkoutController.js

// Update the getCheckoutPage function
const getCheckout = async (req, res) => {
    try {
        // Fetch both cart and addresses concurrently
        const [cart, addresses] = await Promise.all([
            Cart.findOne({ 
                user: req.user._id, 
                active: true 
            }).populate({
                path: 'items.product',
                select: 'productName variants price'
            }),
            Address.find({ userId: req.user._id }) // Add this line to fetch addresses
        ]);

        if (!cart || cart.items.length === 0) {
            return res.redirect('/cart');
        }

        // Calculate totals
        const itemsTotal = cart.items.reduce((total, item) => 
            total + (item.price * item.quantity), 0);
        const shipping = 128;

        const checkoutData = {
            items: cart.items.map(item => ({
                productId: item.product._id,
                product: item.product,
                colorName: item.selectedColor.colorName,
                size: item.selectedSize,
                quantity: item.quantity,
                price: item.price,
                total: item.price * item.quantity
            })),
            totalPrice: itemsTotal,
            shipping: shipping,
            grandTotal: itemsTotal + shipping
        };

        console.log('Checkout Data:', {
            totalPrice: checkoutData.totalPrice,
            shipping: checkoutData.shipping,
            grandTotal: checkoutData.grandTotal
        });

        // Pass both checkoutData and addresses to the template
        res.render('checkout', { checkoutData, addresses });
    } catch (error) {
        console.error('Error loading checkout page:', error);
        res.status(500).render('error', { 
            message: 'Failed to load checkout page. Please try again.' 
        });
    }
};
module.exports ={
    getCheckout
}