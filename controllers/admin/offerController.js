const Offer = require('../../models/offerSchema');
const Product = require('../../models/productSchema');  
const Category = require('../../models/categorySchema');


const getOfferManagement = async (req, res) => {
    try {
        // Pagination parameters
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        // Build query
        const query = {};
        
        // Search functionality
        if (req.query.search) {
            query.name = { $regex: req.query.search, $options: 'i' };
        }

        // Filter by offer type
        if (req.query.offerType) {
            query.offerType = req.query.offerType;
        }

        // Filter by active status
        if (req.query.status) {
            query.isActive = req.query.status === 'active';
        }

        // Fetch offers with pagination and populate references
        
        const offers = await Offer.find(query)
        .populate('category', 'name')
        .populate('product', 'productName')  // Changed from 'name' to 'productName'
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean();
            
        // Get total count for pagination
        const totalOffers = await Offer.countDocuments(query);
        const totalPages = Math.ceil(totalOffers / limit);

        // Fetch categories and products for the add/edit form
        const categories = await Category.find({}, 'name').lean();
        const products = await Product.find({}, 'name').lean();

        // Render the template
        res.render('offerManagement', {
            offers,
            currentPage: page,
            totalPages,
            totalOffers,
            categories,
            products,
            query: req.query // Pass query parameters back to the template
        });

    } catch (error) {
        console.error('Error in getOfferManagement:', error);
        res.status(500).render('error', {
            message: 'Error loading offer management page',
            error: process.env.NODE_ENV === 'development' ? error : {}
        });
    }
};

const getOfferById = async (req, res) => {
    try {
        const offer = await Offer.findById(req.params.id)
            .populate('category', 'name')
            .populate('product', 'productName')
            .lean();

        if (!offer) {
            return res.status(404).json({ error: 'Offer not found' });
        }

        res.json(offer);
    } catch (error) {
        console.error('Error in getOfferById:', error);
        res.status(500).json({ error: 'Error fetching offer details' });
    }
};


const getAddOffer = async (req, res) => {
    try {
        // Initialize an empty offer object with default values
        const offer = {
            name: '',
            offerType: '',
            category: '',
            product: '',
            discountPercentage: '',
            startDate: '',
            endDate: ''
        };

        const categories = await Category.find();
        const products = await Product.find();

        res.render('offerAdd', {
            offer,
            categories,
            products,
            errorMessage: '',
            successMessage: ''
        });
    } catch (error) {
        console.error('Error in getAddOfferPage:', error);
        res.status(500).render('admin/offerAdd', {
            offer: {},
            categories: [],
            products: [],
            errorMessage: 'Failed to load page',
            successMessage: ''
        });
    }
};

const addOffer = async (req, res) => {
    try {
        const { 
            name, 
            offerType, 
            category, 
            product, 
            discountPercentage, 
            startDate, 
            endDate 
        } = req.body;

        // Validate required fields
        if (!name || !offerType || !discountPercentage || !startDate || !endDate) {
            return res.status(400).json({
                success: false,
                message: 'Please fill all required fields'
            });
        }

        // Validate discount percentage
        if (discountPercentage < 0 || discountPercentage > 100) {
            return res.status(400).json({
                success: false,
                message: 'Discount percentage must be between 0 and 100'
            });
        }

        // Validate offer type specific requirements
        if (offerType === 'category' && !category) {
            return res.status(400).json({
                success: false,
                message: 'Please select a category'
            });
        }

        if (offerType === 'product' && !product) {
            return res.status(400).json({
                success: false,
                message: 'Please select a product'
            });
        }

        // Create new offer object
        const newOffer = new Offer({
            name,
            offerType,
            discountPercentage: Number(discountPercentage),
            startDate: new Date(startDate),
            endDate: new Date(endDate),
            isActive: true
        });

        // Add category or product based on offerType
        if (offerType === 'category') {
            newOffer.category = category;
        } else if (offerType === 'product') {
            newOffer.product = product;
        }

        // Check for existing active offers
        let existingOfferQuery = {
            isActive: true,
            endDate: { $gte: new Date() }
        };

        if (offerType === 'category') {
            existingOfferQuery.category = category;
            existingOfferQuery.offerType = 'category';
        } else {
            existingOfferQuery.product = product;
            existingOfferQuery.offerType = 'product';
        }

        const existingOffer = await Offer.findOne(existingOfferQuery);

        if (existingOffer) {
            return res.status(400).json({
                success: false,
                message: `An active offer already exists for this ${offerType}`
            });
        }

        // Save the new offer
        await newOffer.save();

        // Send success response
        return res.status(200).json({
            success: true,
            message: 'Offer created successfully',
            offer: newOffer
        });

    } catch (error) {
        console.error('Error in addOffer:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Failed to create offer'
        });
    }
};

const getEditOffer = async (req, res) => {
    try {
        const offerId = req.params.id;
        
        // Fetch the offer and related data
        const [offer, categories, products] = await Promise.all([
            Offer.findById(offerId),
            Category.find({ isListed: true }),
            Product.find({ isListed: true })
        ]);

        if (!offer) {
            req.flash('error', 'Offer not found');
            return res.redirect('/admin/offers');
        }

        // Format dates for the form
        if (offer.startDate) {
            offer.startDate = offer.startDate.toISOString().split('T')[0];
        }
        if (offer.endDate) {
            offer.endDate = offer.endDate.toISOString().split('T')[0];
        }

        res.render('offerEdit', {
            offer,
            categories,
            products,
            errorMessage: req.flash('error'),
            successMessage: req.flash('success')
        });

    } catch (error) {
        console.error('Error in getEditOffer:', error);
        req.flash('error', 'Failed to load offer editing page');
        res.redirect('/admin/offers');
    }
}

// POST route to handle offer update
const updateOffer = async (req, res) => {
    try {
        const offerId = req.params.id;
        const {
            name,
            offerType,
            category,
            product,
            discountPercentage,
            startDate,
            endDate
        } = req.body;

        // Debug logging
        console.log('Received dates:', {
            startDate,
            endDate,
            startDateType: typeof startDate,
            endDateType: typeof endDate
        });

        // Validate required fields
        if (!name || !offerType || !discountPercentage || !startDate || !endDate) {
            return res.status(400).json({
                success: false,
                message: 'Please fill in all required fields'
            });
        }

        // Convert and normalize dates to handle timezone issues
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);  // Set to end of day
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Debug logging
        console.log('Processed dates:', {
            start: start.toISOString(),
            end: end.toISOString(),
            today: today.toISOString()
        });

        if (start < today) {
            return res.status(400).json({
                success: false,
                message: 'Start date cannot be in the past'
            });
        }

        if (end < start) {
            return res.status(400).json({
                success: false,
                message: 'End date must be after start date'
            });
        }

        // Check for existing offers on the same product/category with corrected date comparison
        const existingOfferQuery = {
            _id: { $ne: offerId },
            isActive: true
        };

        // Add the correct product/category condition
        if (offerType === 'category') {
            existingOfferQuery.category = category;
        } else {
            existingOfferQuery.product = product;
        }

        // Modify date range query to be more precise
        existingOfferQuery.$and = [
            { startDate: { $lte: end } },
            { endDate: { $gte: start } }
        ];

        console.log('Existing offer query:', JSON.stringify(existingOfferQuery, null, 2));

        const existingOffer = await Offer.findOne(existingOfferQuery);

        if (existingOffer) {
            console.log('Found conflicting offer:', existingOffer);
            return res.status(400).json({
                success: false,
                message: 'Another offer already exists for this item during the selected date range'
            });
        }

        // Prepare update data with normalized dates
        const updateData = {
            name,
            offerType,
            discountPercentage: parseFloat(discountPercentage),
            startDate: start,
            endDate: end,
            lastModified: new Date()
        };

        // Set category or product based on offer type
        if (offerType === 'category') {
            if (!category) {
                return res.status(400).json({
                    success: false,
                    message: 'Category is required for category offers'
                });
            }
            updateData.category = category;
            updateData.product = null;
        } else if (offerType === 'product') {
            if (!product) {
                return res.status(400).json({
                    success: false,
                    message: 'Product is required for product offers'
                });
            }
            updateData.product = product;
            updateData.category = null;
        }

        // Update the offer
        const updatedOffer = await Offer.findByIdAndUpdate(
            offerId,
            updateData,
            { new: true, runValidators: true }
        );

        if (!updatedOffer) {
            return res.status(404).json({
                success: false,
                message: 'Offer not found'
            });
        }

        res.status(200).json({
            success: true,
            message: 'Offer updated successfully',
            offer: updatedOffer
        });

    } catch (error) {
        console.error('Error in updateOffer:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to update offer'
        });
    }
}


const toggleOfferStatus = async (req, res) => {
    try {
        const offerId = req.params.id;
        const { isActive } = req.body;

        console.log('Toggling offer status:', { offerId, isActive }); // Add logging

        if (typeof isActive !== 'boolean') {
            return res.status(400).json({
                success: false,
                message: 'Invalid status value'
            });
        }

        const offer = await Offer.findById(offerId);
        
        if (!offer) {
            return res.status(404).json({
                success: false,
                message: 'Offer not found'
            });
        }

        if (isActive) {
            const currentDate = new Date();
            currentDate.setHours(0, 0, 0, 0);

            const endDate = new Date(offer.endDate);
            endDate.setHours(23, 59, 59, 999);

            if (endDate < currentDate) {
                return res.status(400).json({
                    success: false,
                    message: 'Cannot activate an expired offer'
                });
            }
        }

        offer.isActive = isActive;
        await offer.save();

        console.log('Offer status updated successfully:', { offerId, isActive }); // Add logging

        res.status(200).json({
            success: true,
            message: `Offer ${isActive ? 'activated' : 'deactivated'} successfully`
        });

    } catch (error) {
        console.error('Error in toggleOfferStatus:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to update offer status'
        });
    }
};

module.exports = {
    getOfferManagement,
    getOfferById,
    getAddOffer,
    addOffer,
    getEditOffer,
    updateOffer,
    toggleOfferStatus
}