const Category = require('../../models/categorySchema');

// Get category page
const getCatergoryPages = async (req, res) => {
  try {
    const categories = await Category.find();
    res.render('categories', { categories });
  } catch (error) {
    console.log(error.message);
    res.status(500).send('Internal Server Error');
  }
};

module.exports = {
  getCatergoryPages
};
