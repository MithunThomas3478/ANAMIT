const Address = require('../../models/addressSchema');

const getAllAdress = async (req,res) => {
    try {
        const addresses = await Address.find({userId : req.user._id});
        res.render('userAddressManagement',{
            addresses,
            user : req.user,
            title : 'Manage Addressess'
        })
    } catch (error) {
        res.status(500).send('Error fetching addresses');
    }
}

const addAddress = async (req, res) => {
    try {
        const { name, street, city, state, pincode, phone } = req.body;

        // Create new address
        const newAddress = new Address({
            userId: req.user._id, // Assuming you have user info in req.user from auth middleware
            fullName: name,
            streetAddress: street,
            city,
            state,
            pincode,
            phoneNumber: phone
        });

        // Save address to database
        await newAddress.save();

        // If it's an AJAX request, send JSON response
        if (req.xhr || req.headers.accept.indexOf('json') > -1) {
            return res.status(201).json({
                success: true,
                message: 'Address added successfully',
                address: newAddress
            });
        }

        // For regular form submissions, redirect
        req.flash('success', 'Address added successfully');
        res.redirect('/addresses');

    } catch (error) {
        console.error('Error adding address:', error);
        
        // If it's an AJAX request, send JSON response
        if (req.xhr || req.headers.accept.indexOf('json') > -1) {
            return res.status(500).json({
                success: false,
                message: 'Failed to add address'
            });
        }

        // For regular form submissions
        req.flash('error', 'Failed to add address');
        res.redirect('/addresses');
    }
  }

  const updateAddress = async (req, res) => {
    try {
        const { addressId, name, street, city, state, pincode, phone } = req.body;
        
        const updatedAddress = await Address.findByIdAndUpdate(addressId, {
            fullName: name,
            streetAddress: street,
            city: city,
            state: state,
            pincode: pincode,
            phoneNumber: phone
        }, { new: true });

        if (!updatedAddress) {
            return res.status(404).json({
                success: false,
                message: 'Address not found'
            });
        }

        res.json({
            success: true,
            message: 'Address updated successfully',
            address: updatedAddress
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            success: false,
            message: 'Error updating address'
        });
    }
}

  const getEditAddress = async (req, res) => {
    try {
        const address = await Address.findById(req.params.id);
        if (!address) {
            return res.redirect('/userAddress');
        }
        res.render('userAddressEdit', { 
            address,
            title: 'Edit Address'
        });
    } catch (error) {
        console.error(error);
        res.redirect('/userAddress');
    }
}

const deleteAddress = async (req, res) => {
    try {
        const addressId = req.params.id;

        // Find address first to check ownership
        const address = await Address.findById(addressId);

        if (!address) {
            return res.status(404).json({
                success: false,
                message: 'Address not found'
            });
        }

        // Verify that the address belongs to the current user
        if (address.userId.toString() !== req.user._id.toString()) {
            return res.status(403).json({
                success: false,
                message: 'Unauthorized access'
            });
        }

        // Delete the address
        await Address.findByIdAndDelete(addressId);

        // If it's an AJAX request, send JSON response
        if (req.xhr || req.headers.accept.indexOf('json') > -1) {
            return res.status(200).json({
                success: true,
                message: 'Address deleted successfully'
            });
        }

        // For regular requests
        req.flash('success', 'Address deleted successfully');
        res.redirect('/userAddress');

    } catch (error) {
        console.error('Error deleting address:', error);

        // If it's an AJAX request, send JSON response
        if (req.xhr || req.headers.accept.indexOf('json') > -1) {
            return res.status(500).json({
                success: false,
                message: 'Failed to delete address'
            });
        }

        // For regular requests
        req.flash('error', 'Failed to delete address');
        res.redirect('/userAddress');
    }
};

module.exports = {
    getAllAdress,
    addAddress,
    updateAddress,
    getEditAddress,
    deleteAddress 

}