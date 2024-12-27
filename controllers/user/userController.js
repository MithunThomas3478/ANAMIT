const pageNotFound = async (req,res) => {
    try {
       res.render('page_404') 
    } catch (error) {
       res.redirect('/pageNotFound') 
    }
}

const loadHomepage = async (req,res) => {
    try {
        return res.render('home')
    } catch (error) {
        console.log('Home page not found')
        res.status(500).send('server error')
    }
}
module.exports = {
    loadHomepage,
    pageNotFound
}