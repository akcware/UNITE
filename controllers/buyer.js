const crypto = require("crypto");
const express = require("express");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const Token = require("../models/userToken");
const assert = require("assert");
const process = require("process");
const Schema = mongoose.Schema;
const Message = require("../models/message");
const Buyer = require("../models/buyer");
const Supervisor = require("../models/supervisor");
const Supplier = require("../models/supplier");
const Capability = require("../models/capability");
const BidRequest = require("../models/bidRequest");
const ProductService = require("../models/productService");
const Country = require('../models/country');
const BidStatus = require("../models/bidStatus");
const {
  basicFormat,
  customFormat,
  normalFormat
} = require("../middleware/dateConversions");
const async = require("async");
const MongoClient = require("mongodb").MongoClient;
const ObjectId = require("mongodb").ObjectId;
const URL = process.env.MONGODB_URI,
  BASE = process.env.BASE;
const treatError = require("../middleware/treatError");
const search = require("../middleware/searchFlash");
let Recaptcha = require("express-recaptcha").RecaptchaV2;

const {
  fileExists,
  sendConfirmationEmail,
  sendCancellationEmail,
  sendExpiredBidEmails,
  sendInactivationEmail,
  resendTokenEmail,
  sendForgotPasswordEmail,
  sendResetPasswordEmail,
  sendCancelBidEmail,
  prel,
  sortLists,
  getUsers,
  getBidStatusesJson,
  getCancelTypesJson,
  postSignInBody,
  updateBidBody
} = require("../middleware/templates");

const {
  removeAssociatedBuyerBids,
  removeAssociatedSuppBids,
  buyerDelete,
  supervisorDelete,
  supplierDelete
} = require("../middleware/deletion");

const captchaSiteKey = process.env.RECAPTCHA_V2_SITE_KEY;
const captchaSecretKey = process.env.RECAPTCHA_V2_SECRET_KEY;
const fetch = require("node-fetch");
const internalIp = require('internal-ip');
const { verifyBanNewUser, verifyBanExistingUser } = require('../middleware/verifyBanned');


let fx = require("money"),
  initConversions = require("../middleware/exchangeRates");

const TYPE = process.env.USER_BUYER;

exports.getIndex = async (req, res) => {
  if(!req.session || !req.session.buyer) {
    return;
  }
  
      try {
        initConversions(fx);
      }
      catch {
      }
    
    let promise = BidRequest.find({
      buyer: req.session.buyer._id
    }).exec();

    promise.then((bids) => {
      let success = search(req.session.flash, "success"),
        error = search(req.session.flash, "error");
      req.session.flash = [];
      
      Capability.find({}).then((caps) => {
        let cap = [];
        for(let i in caps) {
          cap.push({
            id: i,
            name: caps[i].capabilityDescription
          });
        }
          
        cap.sort(function (a, b) {
          return a.name.localeCompare(b.name);
        });        
        
        setTimeout(function() {
          let totalBidsPrice = 0;      

          if (bids && bids.length && fx) {
            for (let i in bids) {
              totalBidsPrice += fx(parseFloat(bids[i].buyerPrice).toFixed(2))
                .from(bids[i].supplierCurrency)
                .to(process.env.BID_DEFAULT_CURR);          
            }
          }
          
          let buyer = req.session.buyer;
          
          if(buyer.avatar && buyer.avatar.length && !fileExists('public/' + buyer.avatar.substring(3))) {
            buyer.avatar = '';
          }          

          res.render("buyer/index", {
            buyer: buyer,
            MAX_PROD: process.env.BID_MAX_PROD,
            BID_DEFAULT_CURR: process.env.BID_DEFAULT_CURR,
            bidsLength: bids && bids.length ? bids.length : null,
            totalBidsPrice: totalBidsPrice,
            capabilities: cap,
            statuses: null,
            successMessage: success,
            errorMessage: error,
            suppliers: null
            //catalogItems: catalogItems
          });
        }, 1600);
      })
    });   
};


function prepareBidData(req) {
  let productList = prel(req.body.productList);
  let amountList = prel(req.body.amountList, false, true);
  let priceList = prel(req.body.priceList, true, false);
  let priceOriginalList = prel(req.body.priceOriginalList, true, false);
  let imagesList = req.body.productImagesList? prel(req.body.productImagesList) : [];
  let suppCurrListProd = (req.body.supplierCurrenciesListProd)?
                          prel(req.body.supplierCurrenciesListProd) : [];
  
  sortLists(productList, amountList, priceList, imagesList, suppCurrListProd);
  if(!(suppCurrListProd.length) && req.body.supplierCurrency) {
    suppCurrListProd.push(req.body.supplierCurrency);
  }

  let products = [];

  for (let i in productList) {
    products.push(
      "Product name: '" +
        productList[i] +
        "', amount: " +
        (amountList[i]) +
        ", price: " +
        (priceList[i]) +
        " " +
        (req.body.supplierCurrency? req.body.supplierCurrency : suppCurrListProd[i]) +
        (imagesList[i] != null && imagesList[i].length > 0? `, image path: ${imagesList[i]}.` : '.')
    );
  }
  
  return {
    productList: productList, 
    amountList: amountList, 
    priceList: priceList, 
    priceOriginalList: priceOriginalList, 
    imagesList: imagesList, 
    supplierCurrenciesListProd: suppCurrListProd,
    products: products
  };
}


function isPresent(elem, array) {
  if(array.length)
  for(let i in array) {
    if(elem == array[i])
      return true;
  }
  
  return false;
}


function arrangeMultiData(t, suppIds) {
  let productLists = [], amountLists = [], productImagesLists = [], priceLists = [], priceOriginalLists = [], productDetailsLists = [];
  let uniqueSuppIds = [];
  let app = [];
  
  for(let i in suppIds) {//0, 1, 2, 3, 4 - 0=2=4, 1=3.
    //i=0, app=[]
    //i=1, app=024
    //i=2, app=02413
    //i=3, app=02413
    //i=4, app=02413
    let productList = [], amountList = [], productImagesList = [], priceList = [], priceOriginalList = [], productDetailsList = [];
    
    if(!isPresent(suppIds[i], app)) {
      for(let j in suppIds) {//0: 0, 2, 4.
        if(suppIds[i] == suppIds[j]) {
          app.push(suppIds[j]);
          productList.push(t.productList[j]);
          amountList.push(t.amountList[j]);
          productImagesList.push(t.imagesList[j]);
          priceList.push(t.priceList[j]);
          priceOriginalList.push(t.priceOriginalList[j]);
          productDetailsList.push(t.products[j]);
        }
      }
      
      productLists.push(productList);
      amountLists.push(amountList);
      productImagesLists.push(productImagesList);
      priceLists.push(priceList);
      priceOriginalLists.push(priceOriginalList);
      productDetailsLists.push(productDetailsList);
      uniqueSuppIds.push(suppIds[i]);
    }
    
    if(app.length == suppIds.length)
      break;
  }
  
  return {
    productList: productLists, 
    amountList: amountLists, 
    priceList: priceLists, 
    priceOriginalList: priceOriginalLists, 
    imagesList: productImagesLists, 
    products: productDetailsLists,
    uniqueSuppIds: uniqueSuppIds
  };
}


exports.postIndex = (req, res) => {
   initConversions(fx);

  if (req.body.capabilityInput) {
    //req.term for Autocomplete - We started the search and become able to place a Bid Request.
    const key = req.body.capabilityInput;

    Supplier.find({}, (err, suppliers) => {
      if (treatError(req, res, err, "buyer")) return false;

      const suppliers2 = [];
      for (const supplier of suppliers) {
        if (
          supplier.capabilityDescription
            .toLowerCase()
            .includes(key.toLowerCase())
        ) {
          suppliers2.push(supplier);
        }
      }

      let promise = BidStatus.find({}).exec();
      promise.then((statuses) => {
        let promise2 = BidRequest.find({
          buyer: req.session.buyer ? req.session.buyer._id : null
        }).exec();

        promise2.then((bids) => {
          let totalBidsPrice = 0;
          if (bids && bids.length) {
            for (let i in bids) {
              totalBidsPrice += fx(parseFloat(bids[i].buyerPrice).toFixed(2))
                .from(bids[i].supplierCurrency)
                .to(process.env.BID_DEFAULT_CURR);
            }
          }

          let success = search(req.session.flash, "success"),
            error = search(req.session.flash, "error");
          req.session.flash = [];
          res.render("buyer/index", {
            buyer: req.session.buyer,
            suppliers: suppliers2,
            MAX_PROD: process.env.BID_MAX_PROD,
            MAX_AMOUNT: process.env.MAX_PROD_PIECES,
            BID_DEFAULT_CURR: process.env.BID_DEFAULT_CURR,
            bidsLength: bids && bids.length ? bids.length : null,
            totalBidsPrice: totalBidsPrice,
            statuses: statuses,
            successMessage: success,
            errorMessage: error,
            statusesJson: JSON.stringify(getBidStatusesJson())            
          });
        });
      });
    });
  } else if (req.body.itemDescription) {
    console.log(req.body.preferredDeliveryDate);
    //New Bid Request placed.    
    let suppIds = req.body.supplierIdsList? prel(req.body.supplierIdsList) : [];//Multi or not.
    console.log(suppIds.length);
    let t = prepareBidData(req), names, emails, suppCurrencies, suppCurrenciesByProd, totalPricesList;
    
    if(req.body.supplierId) {//Not Multi.
      suppIds.push(req.body.supplierId)
    } else {
      names = req.body.supplierNamesList? prel(req.body.supplierNamesList) : [];
      emails = req.body.supplierEmailsList? prel(req.body.supplierEmailsList) : [];
      suppCurrencies = req.body.supplierCurrenciesList? prel(req.body.supplierCurrenciesList) : [];//currencies
      totalPricesList = req.body.supplierTotalPricesList? prel(req.body.supplierTotalPricesList, true) : [];
      
      t = arrangeMultiData(t, suppIds);
      suppIds = suppIds.filter((v, i, a) => a.indexOf(v) === i);
      //suppIds = t.uniqueSuppIds;
    };   
   
    //Supplier's name, e-mail, currency, total price to be saved as lists in PlaceBid in case of Multi.
    let backPath = '../../../../../../../';
    let asyncCounter = 0;
    
     for(let i = 0; i < suppIds.length; i++) {
       let buyerPrice = !(t.uniqueSuppIds)? req.body.buyerPrice :fx(parseFloat(totalPricesList[i]).toFixed(2))
                .from(suppCurrencies[i])
                .to(req.body.buyerCurrency);
       
       console.log(req.body.supplierPrice);
       
      const bidRequest = new BidRequest({
        requestName: req.body.requestName,
        supplierName: req.body.supplierName? req.body.supplierName : names[i],
        buyerName: req.body.buyerName,
        buyerEmail: req.body.buyerEmail,
        supplierEmail: req.body.supplierEmail? req.body.supplierEmail : emails[i],
        itemDescription: req.body.itemDescription,
        productList: !(t.uniqueSuppIds)? t.productList : t.productList[i],
        amountList: !(t.uniqueSuppIds)? t.amountList : t.amountList[i],
        productImagesList: !(t.uniqueSuppIds)? t.imagesList : t.imagesList[i],
        priceList: !(t.uniqueSuppIds)? t.priceList : t.priceList[i],//Supplier's currency.
        priceOriginalList: !(t.uniqueSuppIds)? t.priceOriginalList : t.priceOriginalList[i],
        productDetailsList: !(t.uniqueSuppIds)? t.products : t.products[i],
        itemDescriptionLong: req.body.itemDescriptionLong,
        itemDescriptionUrl: req.itemDescriptionUrl,
        amount: req.body.amount,
        deliveryLocation: req.body.deliveryLocation,
        deliveryRequirements: req.body.deliveryRequirements,
        complianceRequirements: req.body.complianceRequirements,
        complianceRequirementsUrl: req.body.complianceRequirementsUrl,
        preferredDeliveryDate: req.body.preferredDeliveryDate,
        otherRequirements: req.body.otherRequirements,
        status: req.body.status,
        buyerPrice: buyerPrice,
        supplierPrice: req.body.supplierPrice? req.body.supplierPrice : totalPricesList[i],
        isCancelled: false,
        isExpired: false,
        isExtended: req.body.validityExtensionId? true : false,
        buyerCurrency: req.body.buyerCurrency,
        supplierCurrency: req.body.supplierCurrency? req.body.supplierCurrency : suppCurrencies[i],
        validityExtensionId: req.body.validityExtensionId,
        validityExtension: req.body.validityExtensionId,
        specialMentions: req.body.specialMentions
          ? req.body.specialMentions
          : req.body.buyerName +
            " has sent a new Order to " +
            (req.body.supplierName? req.body.supplierName : names[i]) +
            ", and the Bid price is " +
            (req.body.supplierPrice? req.body.supplierPrice : totalPricesList[i]) +
            " " +
            (req.body.supplierCurrency? req.body.supplierCurrency : suppCurrencies[i]) +
            ".",
        createdAt: req.body.createdAt ? req.body.createdAt : Date.now(),
        updatedAt: Date.now(),
        expiryDate:
          Date.now() + process.env.BID_EXPIRY_DAYS * process.env.DAY_DURATION + (req.body.validityExtensionId? process.env.DAYS_BID_EXTENDED * process.env.DAY_DURATION : 0),
        createdAtFormatted: req.body.createdAt
          ? normalFormat(req.body.createdAt)
          : normalFormat(Date.now()),
        updatedAtFormatted: normalFormat(Date.now()),
        expiryDateFormatted: customFormat(
          Date.now() + process.env.BID_EXPIRY_DAYS * process.env.DAY_DURATION + (req.body.validityExtensionId? process.env.DAYS_BID_EXTENDED * process.env.DAY_DURATION : 0)
        ),
        buyer: req.body.buyer,
        supplier: suppIds[i]
      });
       
      bidRequest
        .save()
        .then((err, result) => {
          if(++asyncCounter == suppIds.length) {
            if(treatError(req, res, err, "../../buyer")) 
              return false;
            
             req.flash("success", "Bid requested successfully!");
             return res.redirect("../../buyer"); 
          }
      })
      .catch(console.error);
    }
  } else if(req.body.bidProductList) {//Place bid on one or more products (+ 1 or more suppliers) from the Product Catalog grid.
      let buyerId = req.body.buyerId, productIds = req.body.bidProductList, supplierIds = req.body.bidSupplierList;
      let productList = prel(productIds);
      let supplierList = prel(supplierIds);
      let prodIDs = [], suppIDs = [];

      for(let i in productList) {
        prodIDs.push(new ObjectId(productList[i]));
      }

      for(let i in supplierList) {
        suppIDs.push(new ObjectId(supplierList[i]));
      }
    
    let uniqueSupplierIds = suppIDs.filter((v, i, a) => a.indexOf(v) === i);
    
  // { $in : [1,2,3,4] }
  //Or array
  Buyer.find({ _id: buyerId }).then((buyer) => {
    if(!buyer) {
        req.flash('error', 'Buyer not found in the database!');
        return res.redirect('back');
      }
  
    ProductService.find({ _id: { $in: prodIDs } }).then((prods) => {
      if(!prods) {
        req.flash('error', 'Products not found!');
        return res.redirect('back');
      }

      Supplier.find({ _id: { $in: uniqueSupplierIds } }).then((sups) => {
        if(!sups) {
          req.flash('error', 'Suppliers for the products not found!');
          return res.redirect('back');
        }
        
        let promise = BidStatus.find({}).exec();
        promise.then((statuses) => {
          let products = [], supps = [];
          
          for(let i in prods) {
            products.push(prods[i]);
          }
          
          for(let i in sups) {
            supps.push(sups[i]);  
          }
          
          let success = search(req.session.flash, "success"), error = search(req.session.flash, "error");
          req.session.flash = [];
          let isMultiProd = prodIDs.length > 1;
          let isMultiSupp = uniqueSupplierIds.length > 1;
          console.log(!isMultiSupp);

          res.render("buyer/placeBid", {
            successMessage: success,
            errorMessage: error,
            isMultiProd: isMultiProd,
            isMultiSupp: isMultiSupp,
            isMultiBid: isMultiSupp,
            isSingleBid: !isMultiSupp, 
            isSingleProd: !isMultiProd,
            MAX_PROD: process.env.BID_MAX_PROD,
            MAX_AMOUNT: process.env.MAX_PROD_PIECES,
            BID_DEFAULT_CURR: process.env.BID_DEFAULT_CURR,
            statuses: statuses,
            statusesJson: JSON.stringify(getBidStatusesJson()),
            buyer: buyer[0],
            product: products[0],
            supplier: supps[0],
            products: products,
            suppliers: supps
            });
          });
        });
      });
    });
  } else {
    res.redirect("/buyer");
  }
};


exports.getPlaceBid = (req, res) => {
  console.log(req.params.buyerId)
  console.log(req.params.productId)
  console.log(req.params.supplierId)  
  
  let buyerId = (req.params.buyerId), productId = (req.params.productId), supplierId = (req.params.supplierId);
  // { $in : [1,2,3,4] }
  //Or array
  Buyer.find({ _id: new ObjectId(buyerId) }).then((buyer) => {
    if(!buyer) {
        req.flash('error', 'Buyer not found in the database!');
        return res.redirect('back');
      }
  
    ProductService.find({ _id: productId }).then((prod) => {
      if(!prod) {
        req.flash('error', 'Product not found!');
        return res.redirect('back');
      }

      Supplier.find({ _id: supplierId }).then((sup) => {
        if(!sup) {
          req.flash('error', 'Supplier for the product not found!');
          return res.redirect('back');
        }
        
        let promise = BidStatus.find({}).exec();
        promise.then((statuses) => {          
          let success = search(req.session.flash, "success"), error = search(req.session.flash, "error");
          req.session.flash = [];          

          res.render("buyer/placeBid", {
            successMessage: success,
            errorMessage: error,
            MAX_PROD: process.env.BID_MAX_PROD,
            MAX_AMOUNT: process.env.MAX_PROD_PIECES,
            BID_DEFAULT_CURR: process.env.BID_DEFAULT_CURR,
            statuses: statuses,
            statusesJson: JSON.stringify(getBidStatusesJson()),
            isMultiProd: false,
            isMultiSupp: false,
            isMultiBid: false,
            isSingleBid: true, 
            isSingleProd: true,
            buyer: buyer[0],
            product: prod[0],
            supplier: sup[0]
            });
          });
        });
      });
    });
}


exports.postPlaceBid = async (req, res) => {
  console.log(req.body.supplierCurrency);
  let t = prepareBidData(req);
  
  //Supplier's name, e-mail, currency, total price to be saved as lists in PlaceBid in case of Multi.
  const bidRequest = new BidRequest({
    requestName: req.body.requestName,
    supplierName: req.body.supplierName,
    buyerName: req.body.buyerName,
    buyerEmail: req.body.buyerEmail,
    supplierEmail: req.body.supplierEmail,
    itemDescription: req.body.itemDescription,
    productList: t.productList,
    amountList: t.amountList,
    productImagesList: t.imagesList,
    priceList: t.priceList, //Supplier's currency.
    priceOriginalList: t.priceOriginalList,
    productDetailsList: t.products,
    itemDescriptionLong: req.body.itemDescriptionLong,
    itemDescriptionUrl: req.itemDescriptionUrl,
    amount: req.body.amount,
    deliveryLocation: req.body.deliveryLocation,
    deliveryRequirements: req.body.deliveryRequirements,
    complianceRequirements: req.body.complianceRequirements,
    complianceRequirementsUrl: req.body.complianceRequirementsUrl,
    preferredDeliveryDate: req.body.preferredDeliveryDate,
    otherRequirements: req.body.otherRequirements,
    status: req.body.status,
    buyerPrice: req.body.buyerPrice,
    supplierPrice: req.body.supplierPrice,
    isCancelled: false,
    isExpired: false,
    isExtended: req.body.validityExtensionId? true : false,
    buyerCurrency: req.body.buyerCurrency,
    supplierCurrency: req.body.supplierCurrency,
    validityExtensionId: req.body.validityExtensionId,
    validityExtension: req.body.validityExtensionId,
    specialMentions: req.body.specialMentions
      ? req.body.specialMentions
      : req.body.buyerName +
        " has sent a new Order to " +
        req.body.supplierName +
        ", and the price is " +
        req.body.price +
        " " +
        req.body.supplierCurrency +
        ".",
    createdAt: req.body.createdAt ? req.body.createdAt : Date.now(),
    updatedAt: Date.now(),
    expiryDate:
      Date.now() + process.env.BID_EXPIRY_DAYS * process.env.DAY_DURATION + (req.body.validityExtensionId? process.env.DAYS_BID_EXTENDED * process.env.DAY_DURATION : 0),
    createdAtFormatted: req.body.createdAt
      ? normalFormat(req.body.createdAt)
      : normalFormat(Date.now()),
    updatedAtFormatted: normalFormat(Date.now()),
    expiryDateFormatted: customFormat(
      Date.now() + process.env.BID_EXPIRY_DAYS * process.env.DAY_DURATION + (req.body.validityExtensionId? process.env.DAYS_BID_EXTENDED * process.env.DAY_DURATION : 0)
    ),
    buyer: req.body.buyer,
    supplier: req.body.supplier
  });

  return bidRequest
    .save()
    .then((err, result) => {
    let path = '../../../../../';
      if(treatError(req, res, err, path+"buyer")) 
        return false;    
    
      req.flash("success", "Bid requested successfully!");
      return res.redirect(path+"/buyer");
    })
    .catch(console.error);
}


exports.getBidsCatalog = (req, res) => {
  MongoClient.connect(URL, { useUnifiedTopology: true }, function(err, db) {
    if (treatError(req, res, err, "back")) 
      return false;

    let dbo = db.db(BASE);
    let query = { buyer: new ObjectId(req.params.buyerId) };
    dbo
      .collection("bidrequests")
      .find(query)
      .toArray(function(err, bids) {
        if (err) {
          console.error(err.message);
          return res.status(500).send({
            msg: err.message
          });
        }

        db.close();
        bids.sort(function(a, b) {
          return a.requestName.localeCompare(b.requestName);
        });
      
        let success = search(req.session.flash, "success"), error = search(req.session.flash, "error");
        req.session.flash = [];

        res.render("buyer/bidsCatalog", {
          buyerName: req.params.buyerName,
          successMessage: success,
          errorMessage: error,
          bids: bids
        });
      });
  });
};

exports.getChatLogin = (req, res) => {
  //We need a username, a room name, and a socket-based ID.
  let success = search(req.session.flash, "success"),
    error = search(req.session.flash, "error");
  req.session.flash = [];

  res.render("buyer/chatLogin", {
    successMessage: success,
    errorMessage: error,
    from: req.params.supplierId,
    to: req.params.buyerId,
    fromName: req.params.supplierName,
    toName: req.params.buyerName,
    reqId: req.params.requestId ? req.params.requestId : 0,
    reqName: req.params.requestName ? req.params.requestName : "None"
  });
};

exports.getChat = (req, res) => {
  //Coming from the getLogin above.
  let success = search(req.session.flash, "success"),
    error = search(req.session.flash, "error");
  req.session.flash = [];

  res.render("supplier/chat", {
    successMessage: success,
    errorMessage: error,
    from: req.params.from,
    to: req.params.to,
    username: req.params.username,
    room: req.params.room,
    fromName: req.params.fromName,
    toName: req.params.toName,
    reqId: req.params.reqId,
    reqName: req.params.reqName
  });
};

exports.getViewBids = (req, res) => {
  let promise = BidRequest.find({
    supplier: req.params.supplierId,
    buyer: req.params.buyerId
  }).exec();

  promise.then(async (bids) => {
    //Verify bids:
    let validBids = [],
      cancelledBids = [],
      expiredBids = [];
    if (bids && bids.length) {
      for (let i in bids) {
        let date = Date.now();
        let bidDate = bids[i].expiryDate;
        bidDate > date
          ? bids[i].isCancelled == true
            ? cancelledBids.push(bids[i])
            : validBids.push(bids[i])
          : expiredBids.push(bids[i]);
      }
    }

    await sendExpiredBidEmails(req, res, expiredBids);
    await initConversions(fx);
    let totalPrice = 0,
      validPrice = 0,
      cancelledPrice = 0,
      expiredPrice = 0;

    for (let i in validBids) {
      //validPrice += fx(parseFloat(validBids[i].price)).from(validBids[i].supplierCurrency).to(req.params.currency);
      if(validBids[i].expirationDate <= Date.now() + process.env.DAYS_BEFORE_BID_EXPIRES * process.env.DAY_DURATION) {
        validBids[i].warningExpiration = true;
        if(validBids[i].isExtended == true) {
          validBids[i].cannotExtendMore = true;
        }
      }
      validPrice += parseFloat(validBids[i].buyerPrice);
    }

    totalPrice = parseFloat(validPrice);

    for (let i in cancelledBids) {
      cancelledPrice += parseFloat(cancelledBids[i].buyerPrice);
    }

    totalPrice += parseFloat(cancelledPrice);

    for (let i in expiredBids) {
      expiredPrice += parseFloat(expiredBids[i].buyerPrice);
    }

    totalPrice += parseFloat(expiredPrice);

    let success = search(req.session.flash, "success"),
      error = search(req.session.flash, "error");
    req.session.flash = [];

    res.render("buyer/viewBid", {
      bids: validBids,
      cancelledBids: cancelledBids,
      expiredBids: expiredBids,
      totalBidLength: bids && bids.length ? bids.length : 0,
      buyerCancelBidStatus: process.env.BUYER_CANCEL_BID,
      stripePublicKey: process.env.STRIPE_KEY_PUBLIC,
      stripeSecretKey: process.env.STRIPE_KEY_SECRET,
      successMessage: success,
      errorMessage: error,
      totalPrice: totalPrice,
      validPrice: validPrice,
      expiredPrice: expiredPrice,
      cancelledPrice: cancelledPrice,
      currency: req.params.currency,
      path: '../../../../',
      bidExtensionDays: process.env.DAYS_BID_EXTENDED,
      statusesJson: JSON.stringify(statusesJson),
      supplierId: req.params.supplierId,
      buyerId: req.params.buyerId,
      balance: req.params.balance
    });
  });
};

exports.postViewBids = (req, res) => {
  updateBidBody(req, res, req.body.id, 'back');
};

exports.getCancelBid = (req, res) => {
  let success = search(req.session.flash, "success"),
    error = search(req.session.flash, "error");
  req.session.flash = [];

  res.render("buyer/cancelBid", {
    successMessage: success,
    errorMessage: error,
    bidId: req.params.bidId,
    bidName: req.params.bidName,
    userType: req.params.userType,
    buyerName: req.params.buyerName,
    supplierName: req.params.supplierName,
    buyerEmail: req.params.buyerEmail,
    supplierEmail: req.params.supplierEmail
  });
};

exports.postCancelBid = (req, res) => {
  try {
    MongoClient.connect(URL, { useUnifiedTopology: true }, async function(
      err,
      db
    ) {
      if (treatError(req, res, err, "back")) return false;
      let dbo = db.db(BASE);

      try {
        await dbo.collection("cancelreasons").insertOne(
          {
            title: req.body.reasonTitle, //Radio!
            cancelType: process.env.BID_CANCEL_TYPE,
            userType: req.body.userType,
            reason: req.body.reason,
            userName: req.body.buyersName,
            createdAt: Date.now()
          },
          function(err, obj) {
            if (treatError(req, res, err, "back")) return false;
          }
        );
      } catch (e) {
        if (treatError(req, res, e, "back")) return false;
      } //Cancelled bids do not have an expiry date any longer:

      await dbo
        .collection("bidrequests")
        .updateOne(
          { _id: new ObjectId(req.body.bidId) },
          {
            $set: {
              isCancelled: true,
              expiryDate: null,
              expiryDateFormatted: null,
              status: parseInt(process.env.BUYER_BID_CANCEL)
            }
          },
          async function(err, resp) {
            if (treatError(req, res, err, "back")) return false;
            await sendCancelBidEmail(
              req,
              req.body.suppliersName,
              req.body.buyersName,
              req.body.suppliersEmail,
              req.body.buyersEmail,
              "Supplier ",
              "Buyer ",
              req.body.reason
            );
            db.close();
            return res.redirect("back");
          }
        );
    });
  } catch {
    //return res.redirect('/buyer/index');
  }
};

exports.getConfirmation = (req, res) => {
  if (!req.session || !req.session.buyerId) {
    req.session = req.session ? req.session : {};
    req.session.buyerId =
      req.params && req.params.token ? req.params.token._userId : null;
  }

  let success = search(req.session.flash, "success"),
    error = search(req.session.flash, "error");
  req.session.flash = [];

  res.render("buyer/confirmation", {
    token: req.params ? req.params.token : null,
    successMessage: success,
    errorMessage: error
  });
};

exports.getDelete = (req, res) => {
  let success = search(req.session.flash, "success"),
    error = search(req.session.flash, "error");
  req.session.flash = [];

  res.render("buyer/delete", {
    id: req.params.id,
    cancelReasonTypesJson: JSON.stringify(getCancelTypesJson()),
    successMessage: success,
    errorMessage: error
  });
};

exports.getDeactivate = (req, res) => {
  let success = search(req.session.flash, "success"),
    error = search(req.session.flash, "error");
  req.session.flash = [];

  res.render("buyer/deactivate", {
    id: req.params.id,
    successMessage: success,
    errorMessage: error
  });
};

exports.getResendToken = (req, res) => {
  let success = search(req.session.flash, "success"),
    error = search(req.session.flash, "error");
  req.session.flash = [];

  res.render("buyer/resend", {
    successMessage: success,
    errorMessage: error
  });
};

exports.postDelete = async function(req, res, next) {
  let id = req.body.id;
  buyerDelete(req, res, id);
};

exports.postDeactivate = async function(req, res, next) {
  let id = req.body.id;
  try {
    //Firstly, a Reason why deactivating the account:
    MongoClient.connect(URL, { useUnifiedTopology: true }, async function(
      err,
      db
    ) {
      let dbo = db.db(BASE);

      //Delete Buyer's Bid Requests first:
      await removeAssociatedBuyerBids(req, dbo, id);

      //And now, remove the Buyer themselves:
      await dbo
        .collection("buyers")
        .updateOne({ _id: id }, { $set: { isActive: false } }, function(
          err,
          resp2
        ) {
          if (treatError(req, res, err, "back")) return false;
        });
      //Finally, send a mail to the ex-Buyer:
      await sendCancellationEmail(
        "Buyer",
        req,
        "placed orders",
        req.body.reason
      );
      db.close();
      req.flash(
        "success",
        "You have deactivated your Buyer account. Logging in will reactivate you."
      );
      return res.redirect("/buyer/sign-in");
    });
  } catch {}
};

exports.postConfirmation = async function(req, res, next) {
  try {
    await Token.findOne({ token: req.params.token, userType: TYPE }, async function(
      err,
      token
    ) {
      if (!token) {
        req.flash(
          "We were unable to find a valid token. It may have expired. Please request a new token."
        );
        return res.redirect("/buyer/resend");
        if (1 == 2)
          return res.status(400).send({
            type: "not-verified",
            msg:
              "We were unable to find a valid token. Your token may have expired."
          });
      }

      await Buyer.findOne(
        { _id: token._userId, emailAddress: req.body.emailAddress },
        async function(err, user) {
          if (!user)
            return res.status(400).send({
              msg: "We were unable to find a user for this token."
            });

          if (user.isVerified)
            return res.status(400).send({
              type: "already-verified",
              msg: "This user has already been verified."
            });

          await MongoClient.connect(
            URL,
            { useUnifiedTopology: true },
            async function(err, db) {
              if (treatError(req, res, err, "back")) return false;

              let dbo = db.db(BASE);
              await dbo
                .collection("buyers")
                .updateOne(
                  { _id: user._id },
                  { $set: { isVerified: true, isActive: true } },
                  function(err, resp) {
                    if (err) {
                      console.error(err.message);
                      return res.status(500).send({
                        msg: err.message
                      });
                    }
                  }
                );

              db.close();
              console.log("The account has been verified. Please log in.");
              req.flash(
                "success",
                "The account has been verified. Please log in."
              );
              return res.redirect("/buyer/sign-in/");
              //res.status(200).send("The account has been verified. Please log in.");
            }
          );
        }
      );
    });
  } catch {}
};

exports.postResendToken = function(req, res, next) {
  /*
    req.assert('emailAddress', 'Email is not valid').isEmail();
    req.assert('emailAddress', 'Email cannot be blank').notEmpty();
    req.sanitize('emailAddress').normalizeEmail({ remove_dots: false });   
    let errors = req.validationErrors();
    if (errors) return res.status(400).send(errors);*/

  Buyer.findOne({ emailAddress: req.body.emailAddress }, function(err, user) {
    if (!user)
      return res
        .status(400)
        .send({ msg: "We were unable to find a user with that email." });
    if (user.isVerified)
      return res
        .status(400)
        .send({
          msg: "This account has already been verified. Please log in."
        });

    let token = new Token({
      _userId: user._id,
      userType: TYPE,
      token: crypto.randomBytes(16).toString("hex")
    });

    token.save(async function(err) {
      if (err) {
        req.flash("error", err.message);
        return res.status(500).send({
          msg: err.message
        });
      }

      await resendTokenEmail(user, token.token, "/buyer/confirmation/", req);
      return res
        .status(200)
        .send(
          "A verification email has been sent to " + user.emailAddress + "."
        );
    });
  });
};

exports.getSignIn = (req, res) => {
  let success = search(req.session.flash, "success"),
    error = search(req.session.flash, "error");
  req.session.flash = [];
console.log('STB')
  if (!req.session.buyerId || !req.session.buyer.isVerified)
    return res.render("buyer/sign-in", {
      captchaSiteKey: captchaSiteKey,
      successMessage: success,
      errorMessage: error
    });
  else return res.redirect("/buyer");
};

exports.getSignUp = (req, res) => {
  let success = search(req.session.flash, "success"),
    error = search(req.session.flash, "error");
  req.session.flash = [];
  
  if (!req.session.buyerId) {
    Country.find({}).then((countries) => {
        let success = search(req.session.flash, 'success'), error = search(req.session.flash, 'error');
        req.session.flash = [];

        let country = [];
        for(let i in countries) {
          country.push({id: i, name: countries[i].name});
        }
      
      Supervisor.find({}, { organizationUniteID: 1 }).then((ids) => {
        let uniteIds = [];
        for(let i in ids) {
          uniteIds.push({
            id: i,
            name: ids[i].organizationUniteID
          });
        }
        
        uniteIds.sort(function (a, b) {
          return a.name.localeCompare(b.name);
        });

        return res.render("buyer/sign-up", {
          DEFAULT_CURR: process.env.BID_DEFAULT_CURR,
          captchaSiteKey: captchaSiteKey,
          uniteIds: uniteIds,
          countries: country,
          successMessage: success,
          errorMessage: error
        });
      });
    });
  }
  else return res.redirect("/buyer");
};

exports.getBalance = (req, res) => {
  res.render("buyer/balance", {
    balance: req.session.buyer.balance,
    appId: process.env.EXCH_RATES_APP_ID,
    currency: req.session.buyer.currency
  });
};

exports.getForgotPassword = (req, res) => {
  let success = search(req.session.flash, "success"),
    error = search(req.session.flash, "error");
  req.session.flash = [];

  res.render("buyer/forgotPassword", {
    email: req.session.buyer.emailAddress,
    successMessage: success,
    errorMessage: error
  });
};

exports.postForgotPassword = (req, res, next) => {
  async.waterfall(
    [
      function(done) {
        crypto.randomBytes(20, function(err, buf) {
          let token = buf.toString("hex");
          done(err, token);
        });
      },
      function(token, done) {
        Buyer.findOne({ emailAddress: req.body.emailAddress }, function(
          err,
          user
        ) {
          if (!user) {
            req.flash(
              "error",
              "Sorry. We were unable to find a user with this e-mail address."
            );
            return res.redirect("buyer/forgotPassword");
          }

          MongoClient.connect(URL, { useUnifiedTopology: true }, function(
            err,
            db
          ) {
            if (treatError(req, res, err, "back")) return false;

            let dbo = db.db(BASE);
            dbo
              .collection("buyers")
              .updateOne(
                { _id: user._id },
                {
                  $set: {
                    resetPasswordToken: token,
                    resetPasswordExpires: Date.now() + 86400000
                  }
                },
                function(err, resp) {
                  if (err) {
                    console.error(err.message);
                    req.flash("error", err.message);
                    return false;
                  }

                  db.close();
                }
              );
          });
        });
      },
      function(token, user, done) {
        sendForgotPasswordEmail(user, "Buyer", "/buyer/reset/", token, req);
      }
    ],
    function(err) {
      if (treatError(req, res, err, "back")) 
        return false;
      return res.redirect("/buyer/forgotPassword");
    }
  );
};

exports.getResetPasswordToken = (req, res) => {
  Buyer.findOne(
    {
      resetPasswordToken: req.params.token,
      resetPasswordExpires: { $gt: Date.now() }
    },
    function(err, user) {
      if (!user) {
        req.flash(
          "error",
          "Password reset token is either invalid or expired."
        );
        return res.redirect("/forgotPassword");
      }

      let success = search(req.session.flash, "success"),
        error = search(req.session.flash, "error");
      req.session.flash = [];

      res.render("buyer/resetPassword", {
        token: req.params.token,
        successMessage: success,
        errorMessage: error
      });
    }
  );
};

exports.postResetPasswordToken = (req, res) => {
  async.waterfall(
    [
      function(done) {
        Buyer.findOne(
          {
            resetPasswordToken: req.params.token,
            resetPasswordExpires: { $gt: Date.now() }
          },
          function(err, user) {
            if (!user) {
              req.flash(
                "error",
                "Password reset token is either invalid or expired."
              );
              return res.redirect("back");
            }

            if (req.body.password === req.body.passwordRepeat) {
              MongoClient.connect(URL, { useUnifiedTopology: true }, function(
                err,
                db
              ) {
                if (treatError(req, res, err, "back")) 
                  return false;
                
                let dbo = db.db(BASE);
                let hash = bcrypt.hashSync(req.body.password, 16);
                
                dbo
                  .collection("buyers")
                  .updateOne(
                    { _id: user._id },
                    {
                      $set: {
                        password: hash,
                        resetPasswordToken: undefined,
                        resetPasswordExpires: undefined
                      }
                    },
                    function(err, resp) {
                      if (treatError(req, res, err, "back")) return false;
                      db.close();
                    }
                  );
              });
            } else {
              req.flash("error", "Passwords do not match.");
              return res.redirect("back");
            }
          }
        );
      },
      function(user, done) {
        sendResetPasswordEmail(user, "Buyer", req);
      }
    ],
    function(err) {
      if (treatError(req, res, err, "back")) return false;
      return res.redirect("/buyer");
    }
  );
};

exports.postSignIn = (req, res) => {
  postSignInBody("buyer", req, res);
};

let global = 0;
function getSupers(id) {
  let promise = Supervisor.find({ organizationUniteID: id }).exec();
  return promise;
}

exports.postSignUp = async (req, res) => {
  const captchaVerified = await fetch(
    "https://www.google.com/recaptcha/api/siteverify?secret=" +
      captchaSecretKey +
      "&response=" +
      req.body.captchaResponse,
    { method: "POST" }
  ).then((res0) => res0.json());

  console.log(captchaVerified);
  
  if (
    req.body.captchaResponse.length == 0 ||
    captchaVerified.success === true
  ) {
    if (req.body.emailAddress) {
      const email = req.body.emailAddress;
      const email_str_arr = email.split("@");
      const domain_str_location = email_str_arr.length - 1;
      const final_domain = email_str_arr[domain_str_location];
      let prohibitedArray = [
        "gmaid.com",
        "hotmaix.com",
        "outloop.com",
        "yandex.com",
        "yahuo.com",
        "gmx"
      ];
      
      for (let i = 0; i < prohibitedArray.length; i++)
        if (
          final_domain.toLowerCase().includes(prohibitedArray[i].toLowerCase())
        ) {
          req.flash("error", "E-mail address must belong to a custom company domain.");
          return res.redirect("/buyer/sign-up");
          
        } else {
          if (req.body.password.length < 6 || req.body.password.length > 16) {
            req.flash("error", "Password must have between 6 and 16 characters.");
            return res.redirect("/buyer/sign-up");
          } else {
            
            let promise = getSupers(req.body.organizationUniteID);
            promise.then(async function(supers) {
              if (supers && supers.length && !supers[0].isActive) {
                req.flash(
                  "error",
                  "Your Supervisor is currently not active. Please contact them."
                );
                return res.redirect("/buyer/sign-up");
              } else if (1 == 2 && (!supers || supers.length == 0)) {
                
                req.flash(
                  "error",
                  "Invalid UNITE ID. Please select an appropriate ID from the list."
                );
                
                return res.redirect("/buyer/sign-up");
              } else if (global++ < 1) {
                const ipv4 = await internalIp.v4();
                
                await Buyer.findOne(
                  { emailAddress: req.body.emailAddress },
                  async function(err, user) {
                    if(treatError(req, res, err, '/supplier/sign-up'))
                      return false;
                    
                    if(verifyBanNewUser(req, res, req.body.emailAddress, ipv4)) {
                      return res.status(400).send({
                        msg: 'You are trying to join UNITE from the part of an already banned user. Please refrain from doing so.'
                      });
                    }
                    
                    if (user)
                      return res
                        .status(400)
                        .send({
                          msg:
                            "The e-mail address you have entered is already associated with another account."
                        });
                    
                    let buyer;
                    
                    try {
                      bcrypt.hash(req.body.password, 16, async function(
                        err,
                        hash
                      ) {
                        buyer = new Buyer({
                          role: process.env.USER_REGULAR,
                          avatar: req.body.avatar,
                          organizationName: req.body.organizationName,
                          organizationUniteID: req.body.organizationUniteID,
                          contactName: req.body.contactName,
                          emailAddress: req.body.emailAddress,
                          password: hash,
                          ipv4: ipv4,
                          isVerified: false,
                          isActive: false,
                          contactMobileNumber: req.body.contactMobileNumber,
                          address: req.body.address,
                          balance: req.body.balance,
                          currency: req.body.currency,
                          deptAgencyGroup: req.body.deptAgencyGroup,
                          qualification: req.body.qualification,
                          country: req.body.country,
                          createdAt: Date.now(),
                          updatedAt: Date.now(),
                          createdAtFormatted: normalFormat(Date.now()),
                          updatedAtFormatted: normalFormat(Date.now())
                        });

                        await buyer.save(async (err) => {
                          if(treatError(req, res, err, "/buyer/sign-up"))
                            return false;

                        req.session.buyer = buyer;
                        req.session.buyerId = buyer._id;
                        await req.session.save(err => {
                          if (treatError(req, res, err, "/buyer/sign-up"))
                            return false;
                        });

                        let token = new Token({
                          _userId: buyer._id,
                          userType: TYPE,
                          token: crypto.randomBytes(16).toString("hex")
                        });

                        await token.save(async function(err) {
                          if (err) {
                            req.flash("error", err.message);
                            console.error(err.message);
                            return res.status(500).send({
                              msg: err.message
                            });
                          }
                        });

                        await sendConfirmationEmail(
                          req.body.organizationName,
                          "/buyer/confirmation/",
                          token.token,
                          req
                        );
                        req.flash(
                          "success",
                          "Buyer signed up successfully! Please confirm your account by visiting " +
                            req.body.emailAddress + ""
                        );
                        setTimeout(function() {
                          return res.redirect("/buyer/sign-in");
                        }, 250);
                      });
                    });
                    } catch {}
                  }
                );
              }
            }); //.catch(console.error);
          }
        }
    }
  } else {
    req.flash("error", "Captcha failed!");
    res.redirect("back");
  }
};

exports.getProfile = (req, res) => {
  if (!req || !req.session) return false;

  let success = search(req.session.flash, "success"),
    error = search(req.session.flash, "error");
  req.session.flash = [];
  
  Country.find({}).then((countries) => {
      let success = search(req.session.flash, 'success'), error = search(req.session.flash, 'error');
      req.session.flash = [];

      let country = [];
      for(let i in countries) {
        country.push({id: i, name: countries[i].name});
      }
        
    res.render("buyer/profile", {
      DEFAULT_CURR: process.env.BID_DEFAULT_CURR,
      successMessage: success,
      countries: country,
      errorMessage: error,
      profile: req.session.buyer
    });
  });
};

exports.postProfile = (req, res) => {
  try {
    Buyer.findOne({ _id: req.body._id }, async (err, doc) => {
      if (treatError(req, res, err, "/buyer/profile")) 
        return false;
      
      const ipv4 = await internalIp.v4();

      doc._id = req.body._id;
      doc.avatar = req.body.avatar;
      doc.role = req.body.role;
      doc.organizationName = req.body.organizationName;
      doc.organizationUniteID = req.body.organizationUniteID;
      doc.contactName = req.body.contactName;
      doc.emailAddress = req.body.emailAddress;
      doc.password = req.body.password;
      doc.ipvs = ipv4;
      doc.isVerified = true;
      doc.isActive = true;
      doc.contactMobileNumber = req.body.contactMobileNumber;
      doc.address = req.body.address;
      doc.balance = req.body.balance;
      doc.currency = req.body.currency;
      doc.deptAgencyGroup = req.body.deptAgencyGroup;
      doc.qualification = req.body.qualification;
      doc.country = req.body.country;
      doc.createdAt = req.body.createdAt;
      doc.updatedAt = Date.now();
      doc.createdAtFormatted = normalFormat(req.body.createdAt);
      doc.updatedAtFormatted = normalFormat(Date.now());

      MongoClient.connect(URL, { useUnifiedTopology: true }, async function(
        err,
        db
      ) {
        if (treatError(req, res, err, "/buyer/profile")) return false;
        let dbo = db.db(BASE);

        await dbo
          .collection("buyers")
          .updateOne({ _id: doc._id }, { $set: doc }, async function(
            err,
            resp
          ) {
            if (treatError(req, res, err, "/buyer/profile")) return false;

            req.session.buyer = doc;
            req.session.buyerId = doc._id;
            await req.session.save();
            db.close();

            console.log("Buyer details updated successfully!");
            req.flash("success", "Buyer details updated successfully!");
            setTimeout(function() {
              return res.redirect("/buyer/profile");
            }, 400);
          });
      });
    });
    //.catch(console.error);
  } catch {
    //return res.redirect('/buyer/profile');
  }
}