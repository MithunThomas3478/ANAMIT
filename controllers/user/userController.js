const user = require('../../models/userSchema')

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

const loadSignUp = async (req,res) => {
    try {
        return res.render('signup')
    } catch (error) {
        console.log('signup page is not found')
        res.status(500).send('server error')
    }
}

const signUp = async (req,res) => {
    const {name,phone,email,password} = req.body
    
    try {
        const newUser = new user({name,phone,email,password})
        console.log(newUser)
        await newUser.save()
        return res.render('home')
    } catch (error) {
        console.error(' register not found'+error)
        return res.status(500).send('Something error')
    }
}



module.exports = {
    loadHomepage,
    pageNotFound,
    loadSignUp,
    signUp
}