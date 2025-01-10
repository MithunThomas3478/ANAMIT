const Product = require('../../models/productSchema');
const Category = require('../../models/categorySchema');

const getProductDetails = async (req, res) => {
        try {
            const productId = req.params.id;
            console.log(productId,'8hbggy')
            // Fetch product with populated category
            const product = await Product.findById(productId)
                .populate('category')
                .lean();

            if (!product) {
                return res.status(404).render('error', {
                    message: 'Product not found'
                });
            }

            // Get similar products from the same category
            const similarProducts = await Product.find({
                category: product.category._id,
                _id: { $ne: productId }, // Exclude current product
                isBlocked: false
            })
            .limit(4)
            .lean();

            res.render('productDetailsPage', {
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