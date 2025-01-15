const Product = require('../../models/productSchema');
const Category = require('../../models/categorySchema');

const getProductDetails= async (req, res) => {
        try {
            const productId = req.params.id;
            const product = await Product.findById(productId)
            .populate('category');
            
            if (!product) {
                return res.status(404).render('error', {
                    message: 'Product not found'
                });
            }

            // Get similar products from same category
            const similarProducts = await Product.find({
                category: product.category._id,
                _id: { $ne: product._id },
                isListed: true
            }).limit(4);

            res.render('buyingInterface', {
                product,
                similarProducts
            });
        } catch (error) {
            console.error('Error in getProductDetails:', error);
            res.status(500).render('error', {
                message: 'Internal server error'
            });
        }
    }


module.exports = {
    getProductDetails

}