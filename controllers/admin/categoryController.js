const Category = require("../../models/categorySchema");

const loadCategory = async (req, res) => {
    try {
        const page = parseInt(req.query.page, 10) || 1;
        const pageSize = 4;
        const skip = (page - 1) * pageSize;

        // Enhanced query with explicit field selection and sorting
        const [categories, totalCount] = await Promise.all([
            Category.find({})
                .select('name description isListed createdAt') // Explicitly select fields
                .sort({ createdAt: -1 }) // Sort by creation date, newest first
                .skip(skip)
                .limit(pageSize)
                .lean(), // Convert to plain JavaScript objects for better performance
            Category.countDocuments()
        ]);

        // Log categories for debugging
        console.log('Fetched categories:', categories);

        const totalPages = Math.ceil(totalCount / pageSize);
        const startIndex = (page - 1) * pageSize;
        const endIndex = Math.min(startIndex + pageSize, totalCount);

        res.render('categoryManagement', {
            categories,
            currentPage: page,
            totalPages,
            pageSize,
            totalCount,
            startIndex,
            endIndex,
            error: null
        });

    } catch (error) {
        console.error('Error fetching categories:', error);
        res.render('categoryManagement', {
            categories: [],
            currentPage: 1,
            totalPages: 0,
            pageSize: 4,
            totalCount: 0,
            startIndex: 0,
            endIndex: 0,
            error: 'Failed to load categories'
        });
    }
};


const renderAddCategoryForm = (req, res) => {
    try {
      res.render('categoryAdd'); // Render the EJS form template
    } catch (error) {
      console.error('Error rendering Add Category form:', error);
      res.status(500).send('An error occurred while loading the category add form.');
    }
  };
  

  const addCategory = async (req, res) => {
    try {
        const { name, description, isListed } = req.body;
        
        // Create base slug from name
        const baseSlug = name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/(^-|-$)/g, '');

        // Check for existing slugs
        let uniqueSlug = baseSlug;
        let count = 1;
        while (await Category.findOne({ slug: uniqueSlug })) {
            uniqueSlug = `aaaaaaaaaaa`;
            count++;
        }

        // Create new category with the generated slug
        const category = new Category({
            name,
            description,
            isListed,
            slug: uniqueSlug
        });

        await category.save();

        res.json({
            success: true,
            message: 'Category added successfully'
        });

    } catch (error) {
        console.error('Error adding category:', error);
        res.status(400).json({
            success: false,
            message: error.message || 'Error adding category'
        });
    }
};



const loadEditPage = async (req, res) => {
    try {
        const categoryId = req.params.id;
        const category = await Category.findById(categoryId);
        
        if (!category) {
            return res.redirect('/admin/categoryManagement');
        }

        res.render('categoryEdit', { category });
    } catch (error) {
        console.error('Error loading edit page:', error);
        res.redirect('/admin/categoryManagement');
    }
};

const updateCategory = async (req, res) => {
    try {
        const categoryId = req.params.id;
        const { name, description, isListed } = req.body;

        // Basic validation
        if (!name?.trim() || !description?.trim()) {
            return res.status(400).json({
                success: false,
                message: 'Name and description are required'
            });
        }

        // Find current category
        const currentCategory = await Category.findById(categoryId);
        if (!currentCategory) {
            return res.status(404).json({
                success: false,
                message: 'Category not found'
            });
        }

        // Prepare update object
        const updates = {
            name,
            description,
            isListed,
            slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
            updatedAt: new Date()
        };

        // Update category
        const updatedCategory = await Category.findByIdAndUpdate(
            categoryId,
            { $set: updates },
            { new: true, runValidators: true }
        );

        res.status(200).json({
            success: true,
            message: 'Category updated successfully',
            category: updatedCategory
        });

    } catch (error) {
        console.error('Update Error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Error updating category'
        });
    }
};

const toggleStatus = async (req, res) => {
    try {
        const categoryId = req.params.id;
        const { isListed } = req.body;
        
        const category = await Category.findByIdAndUpdate(
            categoryId,
            { 
                isListed,
                updatedAt: new Date()
            },
            { new: true }
        );

        if (!category) {
            return res.status(404).json({
                success: false,
                message: 'Category not found'
            });
        }

        res.status(200).json({
            success: true,
            message: `Category ${isListed ? 'listed' : 'unlisted'} successfully`,
            isListed: category.isListed
        });

    } catch (error) {
        console.error('Toggle Status Error:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating category status'
        });
    }
};


const deleteCategory = async (req, res) => {
        try {
            const categoryId = req.params.id;
            
            // Check if category exists
            const category = await Category.findById(categoryId);
            if (!category) {
                return res.status(404).json({
                    success: false,
                    message: 'Category not found'
                });
            }

            // Delete the category
            await Category.findByIdAndDelete(categoryId);

            return res.status(200).json({
                success: true,
                message: 'Category deleted successfully'
            });

        } catch (error) {
            console.error('Delete category error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    }



 module.exports = {
    loadCategory,
    renderAddCategoryForm,
    addCategory,
    updateCategory,
    loadEditPage,
    toggleStatus,
    deleteCategory
 }