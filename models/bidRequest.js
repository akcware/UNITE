const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const process = require('process');

const bidRequestSchema = new Schema({
  requestName: {
    type: String,
    unique: true,
    required: true
  },
  supplierName: {
    type: String,
    required: true
  },
  buyerName: {
    type: String,
    required: true
  },
  buyerEmail: {
    type: String,
    required: true
  },
  supplierEmail: {
    type: String,
    required: true
  },
  itemDescription: {
    type: String,
    required: true
  },
  productsServicesOffered: {
    type: [String],
    required: true
  },
  itemDescriptionLong: {
    type: String,
    required: true
  },
  itemDescriptionUrl: {
    type: String,
    required: false
  },
  amount: {
    type: Number,
    validate(value) {
      if(value < 0) {
        throw new Error('Please specify a valid number.');
      }
    },
    required: true
  },
  buyerCurrency: {
    type: String,
    required: true,
  },
  supplierCurrency: {
    type: String,
    required: true,
  },
  orderedProducts: [String],//Schema.Types.Mixed,
  amountList: {
    type: [Number],
    required: true
  },
  priceList: {//Converted to Supplier's currency.
    type: [Number],
    required: true
  },
  productImagesList: {
    type: [String],
    required: true
  },
  deliveryLocation: {
    type: String,
    required: true
  },
  deliveryRequirements: {
    type: String,
    required: true,
  },
  complianceRequirements: {
    type: String,
    required: true
  },
  complianceRequirementsUrl: {
    type: String,
    required: false
  },
  otherRequirements: {
    type: String,
    required: false
  },
  specialMentions: {
    type: String,
    required: false
  },
  status: {
    type: Number,
    required: true,
    validate(value) {
      if(value < 0 || value >= 7) {
        throw new Error('Status must be an integer from 0 to 6.');
      }
    },
    default: 0
  },
  buyerPrice: {//In Buyer's currency.
    type: Number,
    required: true,
    default: 1,
    validate(value) {
      if(value < 1) {
        throw new Error('Price must be a strictly positive value.');
      }
    }
  },
  supplierPrice: {//In Supplier's currency.
    type: Number,
    required: true,
    default: 1,
    validate(value) {
      if(value < 1) {
        throw new Error('Price must be a strictly positive value.');
      }
    }
  },
  isCancelled: {
    type: Boolean,
    default: false
  },
  createdAt: {
    type: Date,
    default: Date.now()
  },
  updatedAt: {
    type: Date,
    default: Date.now()
  },
  expiryDate: {
    type: Date,
    default: Date.now() + process.env.BID_EXPIRY_DAYS * process.env.DAY_DURATION
  },
  createdAtFormatted: {
    type: String,
    required: true
  },
  updatedAtFormatted: {
    type: String,
    required: false
  },
  expiryDateFormatted: {
    type: String,
    required: true
  },
  isExpired: {
    type: Boolean,
    //required: true,
    default: false
  },
  buyer: {
    type: Schema.Types.ObjectId, // Buyer's object id -> It will be generated from current session
    required: true
  },
  supplier: {
    type: Schema.Types.ObjectId, // Supplier's object id -> It will be generated from current session
    required: true
  }
});

module.exports = mongoose.model('BidRequest', bidRequestSchema);