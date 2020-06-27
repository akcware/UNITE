const bcrypt = require("bcryptjs");
const Supplier = require("../models/supplier");
const Buyer = require("../models/buyer");
const BidRequest = require("../models/bidRequest");
const BidStatus = require("../models/bidStatus");
const ProductService = require("../models/productService");
const Capability = require("../models/capability");
const Industry = require("../models/industry");
const Message = require("../models/message");
const Token = require("../models/supplierToken");
const assert = require("assert");
const process = require("process");
const async = require("async");
const crypto = require('crypto');
//sgMail.setApiKey('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');
//process.env.SENDGRID_API_KEY = "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";
const MongoClient = require("mongodb").MongoClient;
const ObjectId = require("mongodb").ObjectId;
const URL = process.env.MONGODB_URI, BASE = process.env.BASE;
const treatError = require('../middleware/treatError');
const search = require('../middleware/searchFlash');
var Recaptcha = require('express-recaptcha').RecaptchaV3;
const { sendConfirmationEmail, sendCancellationEmail, sendInactivationEmail, resendTokenEmail, sendForgotPasswordEmail, sendResetPasswordEmail, sendCancelBidEmail, postSignInBody } = require('../public/templates');
const { removeAssociatedBuyerBids, removeAssociatedSuppBids, buyerDelete, supervisorDelete, supplierDelete } = require('../middleware/deletion');
const captchaSiteKey = process.env.RECAPTCHA_V2_SITE_KEY;

const statusesJson = {
  BUYER_REQUESTED_BID: parseInt(process.env.BUYER_REQ_BID),
  WAIT_BUYER_PROCESS_INFO: parseInt(process.env.BUYER_PROC_INFO),
  BUYER_WANTS_FOR_PRICE: parseInt(process.env.BUYER_ACCEPT_PRICE),
  SUPP_STARTED_DELIVERY: parseInt(process.env.SUPP_START_DELIVERY),
  PAYMENT_DELIVERY_DONE: parseInt(process.env.PAYMENT_DELIVERY_DONE),
  SUPPLIER_CANCELS_BID: parseInt(process.env.SUPP_CANCEL_BID),
  BUYER_CANCELS_BID: parseInt(process.env.BUYER_CANCEL_BID)
};

exports.getIndex = (req, res) => {
  if (!req || !req.session) 
    return false;
  const supplier = req.session.supplier;
  var success = search(req.session.flash, 'success'), error = search(req.session.flash, 'error');
  req.session.flash = [];

  BidRequest.find({ supplier: supplier._id })
    .then((requests) => {
      const requestsCount = requests.length;

      res.render("supplier/index", {
        supplier: supplier,
        requestsCount: requestsCount,
        successMessage: success,
        errorMessage: error
      });
    })
    .catch(console.error);
}


exports.getAddProduct = (req, res) => {
  var success = search(req.session.flash, 'success'), error = search(req.session.flash, 'error');
  req.session.flash = [];
  
  res.render("supplier/addProduct", {
    supplierId: req.session.supplier._id,
    successMessage: success,
    errorMessage: error
  });
}


exports.postAddProduct = (req, res) => {
  if (!req.body.productPrice) {
    console.error("Price is not valid, please correct it.");
    req.flash('error', 'Price is not valid, please correct it.');
    return res.redirect("back");
  } else {
    const product = new ProductService({
      supplier: req.body._id,
      productName: req.body.productName,
      price: parseFloat(req.body.price),
      currency: req.body.currency ? req.body.currency : "EUR",
      createdAt: Date.now(),
      updatedAt: Date.now()
    });

    product
      .save()
      .then(() => {
        req.flash("success", "Product added successfully!");
        return res.redirect("/supplier/profile");
      })
      .catch(console.error);
  }
}


exports.getCancelBid = (req, res) => {
  var success = search(req.session.flash, 'success'), error = search(req.session.flash, 'error');
  req.session.flash = [];
  
  res.render('supplier/cancelBid', {
    bidId: req.params.bidId,
    bidName: req.params.bidName,
    userType: req.params.userType,
    buyerName: req.params.buyerName,
    supplierName: req.params.supplierName,
    buyerEmail: req.params.buyerEmail,
    supplierEmail: req.params.supplierEmail,
    successMessage: success,
    errorMessage: error
  });  
}


exports.postCancelBid = (req, res) => {
  //BidRequest.findOne({_id: req.params.bidId});
  try {
  MongoClient.connect(URL, {useUnifiedTopology: true}, async function(err, db) {
      if(treatError(req, res, err, 'back'))
        return false;
      var dbo = db.db(BASE);
    
      try {
        await dbo.collection('bidcancelreasons').insertOne( {
          title: req.body.cancelTitle,
          userType: req.body.userType,
          reason: req.body.reason,
          userName: req.body.suppliersName,
          createdAt: Date.now()
        }, function(err, obj) {
          if(treatError(req, res, err, 'back'))
            return false;
        });
      }
      catch(e) {
        console.error(e);
        req.flash('error', e.message);
      }
    
      await dbo.collection("bidrequests").updateOne({ _id: new ObjectId(req.body.bidId) }, { $set: {isCancelled: true, status: parseInt(process.env.SUPP_BID_CANCEL)} }, async function(err, resp) {
        if(err) {
          console.error(err.message);
          return res.status(500).send({ 
            msg: err.message 
          });         
        }

        await sendCancelBidEmail(req, req.body.buyersName, req.body.suppliersName, req.body.buyersEmail, req.body.suppliersEmail, 'Buyer ', 'Supplier ', req.body.reason);
        return res.redirect('back');
      });
    
    db.close();
    });
  } catch {
    //return res.redirect('/supplier/index');
  }  
}


exports.getConfirmation = (req, res) => {
  if(!req.session || !req.session.supplierId) {
    req.session = req.session? req.session : {};
    req.session.supplierId = req.params && req.params.token? req.params.token._userId : null;
  }
  
  var success = search(req.session.flash, 'success'), error = search(req.session.flash, 'error');
  req.session.flash = [];
  
  res.render("supplier/confirmation", { 
    token: req.params? req.params.token : null,
    successMessage: success,
    errorMessage: error
  });
}

exports.getDelete = (req, res) => {
  var success = search(req.session.flash, 'success'), error = search(req.session.flash, 'error');
  req.session.flash = [];
  
  res.render('supplier/delete', {
    id: req.params.id,
    successMessage: success,
    errorMessage: error
  });
}

exports.getDeactivate = (req, res) => {
  var success = search(req.session.flash, 'success'), error = search(req.session.flash, 'error');
  req.session.flash = [];
  
  res.render('supplier/deactivate', {
    id: req.params.id,
    successMessage: success,
    errorMessage: error
  });
}

exports.getResendToken = (req, res) => {
  var success = search(req.session.flash, 'success'), error = search(req.session.flash, 'error');
  req.session.flash = [];
  
  res.render("supplier/resend", {
    successMessage: success,
    errorMessage: error
  });
}


exports.postDelete = function (req, res, next) {  
  var id = req.body.id;
  supplierDelete(req, res, id);
}


exports.postDeactivate = function (req, res, next) {  
  var id = req.body.id;
  try {
    //Delete Supplier's Capabilities first:
    MongoClient.connect(URL, {useUnifiedTopology: true}, async function(err, db) {
      if(treatError(req, res, err, 'back'))
        return false;
      var dbo = db.db(BASE);
      /*
      try {
        await dbo.collection('cancelreasons').insertOne( {//To replace with a possible InactivationReason.
          type: req.body.type,
          reason: req.body.reason,
          userType: req.body.userType,
          userName: req.body.companyName,
          createdAt: Date.now()
        }, function(err, obj) {});
      } catch(e) {
        console.error(e);
      }*/
      
      await dbo.collection('capabilities').deleteMany({ supplier: id }, function(err, resp) {
        if(treatError(req, res, err, 'back'))
          return false;
      });
        
      //Products/Services offered:
      await dbo.collection('productservices').deleteMany({ supplier: id }, function(err, resp0) {
        if(treatError(req, res, err, 'back'))
          return false;
      });    
    
      //The received bids:
      await removeAssociatedSuppBids(req, dbo, id);

      //And now, deactivate the Supplier themselves:
      await dbo.collection('suppliers').updateOne( { _id: id }, { $set: { isActive: false } }, function(err, resp4) {
        if(treatError(req, res, err, 'back'))
          return false;
      });

      //Finally, send a mail to the ex-Supplier:
      await sendCancellationEmail('Supplier', req, 'received orders, products/services offered, listed capabilities', req.body.reason);
      db.close();
      req.flash('success', 'You have deactivated your Supplier account. Logging in will reactivate you.');
      return res.redirect("/supplier/sign-in");
    });
  } catch {
    //return res.redirect("/supplier");
  }
}


exports.postConfirmation = async function(req, res, next) {
  //assert("token", "Token cannot be blank").notEmpty();
  //req.sanitize("emailAddress").normalizeEmail({ remove_dots: false });
  //var errors = req.validationErrors();
  //if (errors) return res.status(400).send(errors);  

  await Token.findOne({ token: req.params.token }, async function(err, token) {
    if (!token) {
      req.flash(
        'error', "We were unable to find a valid token. It may have expired. Please request a new confirmation token."
      );
  
      return res.redirect("/supplier/resend");
    }
  
    await Supplier.findOne({ _id: token._userId, emailAddress: req.body.emailAddress }, async function (err, user) {
      if (!user) 
        return res.status(400).send({
        msg: 'We were unable to find a user for this token.' 
      });

      if (user.isVerified) 
        return res.status(400).send({ 
        type: 'already-verified', 
        msg: 'This user has already been verified.' });
      

      await MongoClient.connect(URL, {useUnifiedTopology: true}, async function(err, db) {//db or client.
        if(treatError(req, res, err, 'back'))
          return false;
        var dbo = db.db(BASE);
            
        await dbo.collection("suppliers").updateOne({ _id: user._id }, { $set: { isVerified: true, isActive: true } }, function(err, resp) {
              if(err) {
                res.status(500).send(err.message);
              }
        });

        console.log("The account has been verified. Please log in.");
        req.flash('success', "The account has been verified. Please log in.");
        db.close();
        res.status(200).send("The account has been verified. Please log in.");
      });
    });         
  });
}


exports.postResendToken = function(req, res, next) {
  Supplier.findOne({ emailAddress: req.body.emailAddress }, function(err, user) {
    if (!user)
      return res
        .status(400)
        .send({ msg: "We were unable to find a user with that email." });
    if (user.isVerified)
      return res.status(400).send({
        msg: "This account has already been verified. Please log in."
      });

    var token = new Token({
      _userId: user._id,
      token: crypto.randomBytes(16).toString("hex")
    });

    // Save the token
    token.save(async function(err) {
      if (err) {
        return res.status(500).send({ msg: err.message });
      }

      await resendTokenEmail(user, token.token, '/supplier/confirmation/', req);
      return res.status(200).send('A verification email has been sent to ' + user.emailAddress + '.');
    });
  });
}


exports.getSignIn = (req, res) => {
  if (!req.session.supplierId || !req.session.supplier.isVerified) {
    var success = search(req.session.flash, 'success'), error = search(req.session.flash, 'error');
    req.session.flash = [];
    
    return res.render("supplier/sign-in", {
      captchaSiteKey: captchaSiteKey,
      successMessage: success,
      errorMessage: error
    });
  } else 
    return res.redirect("/supplier");
}


exports.postSignIn = async (req, res) => {
  postSignInBody('supplier', req, res);
}


exports.getSignUp = (req, res) => {
  var success = search(req.session.flash, 'success'), error = search(req.session.flash, 'error');
  req.session.flash = [];
  
  if (!req.session.supplierId)
    return res.render("supplier/sign-up", {
      MAX_PROD: process.env.SUPP_MAX_PROD,
      DEFAULT_CURR: process.env.SUPP_DEFAULT_CURR,
      captchaSiteKey: captchaSiteKey,
      successMessage: success,
      errorMessage: error
    });
  else 
    return res.redirect("/supplier");
};


function prel(req, isNumber) {
  var arr = (req);
  arr = arr.split(',');
  var newProd = [];
  for (var i in arr) {
    newProd.push(isNumber? parseFloat(arr[i]) : String(arr[i]));
    }
  
  return newProd;
}


let global = 0;
exports.postSignUp = async (req, res) => {
  if (req.body.emailAddress) {
    const email = req.body.emailAddress;
    const email_str_arr = email.split("@");
    const domain_str_location = email_str_arr.length - 1;
    const final_domain = email_str_arr[domain_str_location];
    var prohibitedArray = ["gmaid.com", "hotmaix.com", "outloop.com", "yandex.com", "yahuo.com", "gmx"];

    for (var i = 0; i < prohibitedArray.length; i++)
      if (final_domain.toLowerCase().includes(prohibitedArray[i].toLowerCase())) {
        req.flash("error", "E-mail address must belong to a custom company domain.");
        return res.redirect("/supplier/sign-up"); //supplier/sign-up
      } else {
        if (req.body.password.length < 6) {
          req.flash("error", "Password must have at least 6 characters.");
          return res.redirect("/supplier/sign-up");
          var supplier;
          //Prevent duplicate attempts:
        } else if (global++ < 1) {
          await Supplier.findOne({ emailAddress: req.body.emailAddress }, function(err,  user) {
            if(treatError(req, res, err, '/supplier/sign-up'))
              return false;
            
            if (user)
              return res.status(400).send({
                msg:
                  "The e-mail address you have entered is already associated with another account."
              });
          }).catch(console.error);
          
          try {
            await bcrypt.hash(req.body.password, 16, async function(err, hash) {
                supplier = new Supplier({
                  role: process.env.USER_REGULAR,
                  avatar: req.body.avatar,
                  companyName: req.body.companyName,
                  directorsName: req.body.directorsName,
                  contactName: req.body.contactName,
                  title: req.body.title,
                  companyRegistrationNo: req.body.companyRegistrationNo,
                  emailAddress: req.body.emailAddress,
                  password: req.body.password,
                  isVerified: false,
                  isActive: false,
                  registeredCountry: req.body.registeredCountry,
                  companyAddress: req.body.companyAddress,
                  areaCovered: req.body.areaCovered,
                  contactMobileNumber: req.body.contactMobileNumber,
                  country: req.body.country,
                  industry: req.body.industry,
                  employeeNumbers: req.body.employeeNumbers,
                  lastYearTurnover: req.body.lastYearTurnover,
                  website: req.body.website,
                  productsServicesOffered: prel(req.body.productsServicesOffered),
                  pricesList: prel(req.body.pricesList, true),
                  currenciesList: prel(req.body.currenciesList),
                  capabilityDescription: req.body.capabilityDescription,
                  relevantExperience: req.body.relevantExperience,
                  supportingInformation: req.body.supportingInformation,
                  certificates: req.body.certificatesIds,
                  antibriberyPolicy: req.body.antibriberyPolicyId,
                  environmentPolicy: req.body.environmentPolicyId,
                  qualityManagementPolicy: req.body.qualityManagementPolicyId,
                  occupationalSafetyAndHealthPolicy: req.body.occupationalSafetyAndHealthPolicyId,
                  otherRelevantFiles: req.body.otherRelevantFilesIds,
                  certificatesIds: req.body.certificatesIds,
                  antibriberyPolicyId: req.body.antibriberyPolicyId,
                  environmentPolicyId: req.body.environmentPolicyId,
                  qualityManagementPolicyId: req.body.qualityManagementPolicyId,
                  occupationalSafetyAndHealthPolicyId: req.body.occupationalSafetyAndHealthPolicyId,
                  otherRelevantFilesIds: req.body.otherRelevantFilesIds,
                  balance: req.body.balance,
                  currency: req.body.currency,
                  facebookURL: req.body.facebookURL,
                  instagramURL: req.body.instagramURL,
                  twitterURL: req.body.twitterURL,
                  linkedinURL: req.body.linkedinURL,
                  otherSocialMediaURL: req.body.otherSocialMediaURL,
                  UNITETermsAndConditions: true,//We assume that user was constrainted to check them.
                  antibriberyAgreement: true,
                  createdAt: Date.now(),
                  updatedAt: Date.now()
                });

                await supplier.save(async (err) => {
                  if (err) {
                    req.flash('error', err.message);
                    console.error(err);
                     return res.status(500).send({
                         msg: err.message
                         });
                  }
                });
                  
                  req.session.supplier = supplier;
                  req.session.supplierId = supplier._id;
                  await req.session.save();
                  
                  var capability = new Capability({
                    supplier: supplier._id,
                    capabilityDescription: supplier.capabilityDescription,
                    createdAt: Date.now(),
                    updatedAt: Date.now()
                  });

                  await capability.save(function(err) {
                    if(treatError(req, res, err, '/supplier/sign-up'))
                      return false;
                    console.log('Capability saved!');
                  });
                  
                  var token = new Token({
                    _userId: supplier._id,
                    token: crypto.randomBytes(16).toString("hex")
                  });
                  
                  await token.save(async function(err) {
                    if (err) {
                      req.flash('error', err.message);
                      console.error(err.message);
                      return res.status(500).send({
                        msg: err.message
                       });
                        }
                  });
              
                  var industry = new Industry({
                    name: req.body.industry
                  });
              
                  industry.save((err) => {
                    if(treatError(req, res, err, '/supplier/sign-up'))
                      return false;//If that industry already exists.
                  });
                    
                  await sendConfirmationEmail(supplier.companyName, "/supplier/confirmation/", token.token, req);

                  if (Array.isArray(supplier.productsServicesOffered)) {
                    for (var i in supplier.productsServicesOffered) {
                      var productService = new ProductService({
                        supplier: supplier._id,
                        productName: supplier.productsServicesOffered[i],
                        price: parseFloat(supplier.pricesList[i]),
                        currency: supplier.currenciesList[i],
                        createdAt: Date.now(),
                        updatedAt: Date.now()
                      });

                      await productService.save((err) => {
                        if(treatError(req, res, err, '/supplier/sign-up'))
                          return false;
                      });
                    }
                    
                  console.log('All products saved!');
                  req.flash("success", "Supplier signed up successfully! Please confirm your account by visiting " + req.body.emailAddress + '');
                  setTimeout(function() {
                      return res.redirect("/supplier/sign-in");
                    }, 250);
                  }
            });
       } catch {              
       }
      }
    }
  }
}


exports.getForgotPassword = (req, res) => {
  var success = search(req.session.flash, 'success'), error = search(req.session.flash, 'error');
  req.session.flash = [];
  
  res.render("supplier/forgotPassword", {
    email: req.session.supplier.emailAddress,
    successMessage: success,
    errorMessage: error
  });
}


exports.getChatLogin = (req, res) => {//We need a username, a room name, and a socket-based ID.
  res.render("supplier/chatLogin", {
    from: req.params.supplierId,
    to: req.params.buyerId,
    fromName: req.params.supplierName,
    toName: req.params.buyerName,
    reqId: req.params.requestId? req.params.requestId : 0,
    reqName: req.params.requestName? req.params.requestName : 'None'
  });
}


exports.getChat = (req, res) => {//Coming from the getLogin above.
  res.render("supplier/chat", {
    from: req.params.from,
    to: req.params.to,
    username: req.params.username,
    room: req.params.room,
    fromName: req.params.fromName,
    toName: req.params.toName,
    reqId: req.params.reqId,
    reqName: req.params.reqName
  });
}


exports.postForgotPassword = (req, res, next) => {
  async.waterfall(
    [
      function(done) {
        crypto.randomBytes(20, function(err, buf) {
          var token = buf.toString("hex");
          done(err, token);
        });
      },
      function(token, done) {
        Supplier.findOne({ emailAddress: req.body.emailAddress }, function (err, user) {
          if (!user) {
            req.flash('error', 'Sorry. We were unable to find a user with this e-mail address.');
            return res.redirect('supplier/forgotPassword');
          }

          MongoClient.connect(URL, {useUnifiedTopology: true}, function(err, db) {
            if(treatError(req, res, err, 'back'))
              return false;
            
            var dbo = db.db(BASE);
            dbo.collection("suppliers").updateOne({ _id: user._id }, { $set: {resetPasswordToken: token, resetPasswordExpires: Date.now() + 86400000} }, function(err, resp) {        
              if(treatError(req, res, err, 'back'))
                return false;
              db.close();
            });
          });
        });
      },
      function(token, user, done) {
        sendForgotPasswordEmail(user, 'Supplier', "/supplier/reset/", token, req);
      }
    ],
    function(err) {
      if(treatError(req, res, err, 'back'))
        return false;
      return res.redirect("/supplier/forgotPassword");
    });
};

exports.getResetPasswordToken = (req, res) => {
  var success = search(req.session.flash, 'success'), error = search(req.session.flash, 'error');
  req.session.flash = [];
  
  Supplier.findOne({
      resetPasswordToken: req.params.token,
      resetPasswordExpires: { $gt: Date.now() }
    }, function(err, user) {
      if (!user) {
        req.flash("error", "Password reset token is either invalid or expired.");
        return res.redirect("supplier/forgotPassword");
      }
      res.render("supplier/resetPassword", { 
        token: req.params.token,
        successMessage: success,
        errorMessage: error
      });
    });
};

exports.postResetPasswordToken = (req, res) => {
  async.waterfall([
    function(done) {
      Supplier.findOne({resetPasswordToken: req.params.token, 
                     resetPasswordExpires: { $gt: Date.now() }
                    }, function(err, user) {
      if(!user) {
        req.flash('error', 'Password reset token is either invalid or expired.');
        return res.redirect('back');
      }
        
    if(req.body.password === req.body.confirm) {
        MongoClient.connect(URL, {useUnifiedTopology: true}, function(err, db) {
          if(treatError(req, res, err, 'back'))
            return false;
          var dbo = db.db(BASE);
          
          dbo.collection("suppliers").updateOne({ _id: user._id }, { $set: {password: req.body.password, resetPasswordToken: undefined, resetPasswordExpires: undefined} }, function(err, resp) {
            if(treatError(req, res, err, 'back'))
              return false;
            db.close();
          });
        });
      } else {
        req.flash('error', 'Passwords do not match.');
        return res.redirect('back');
      }
    });
    },
      function(user, done) {
        sendResetPasswordEmail(user, 'Supplier', req);
      }
    ],
    function(err) {
      if(treatError(req, res, err, 'back'))
        return false;
      return res.redirect("/supplier");
    }
  );
}


exports.getProfile = (req, res) => {
  if (!req || !req.session) 
    return false;
  const supplier = req.session.supplier;

  ProductService.find({ supplier: supplier._id })
    .then((products) => {
      req.session.supplier.productsServicesOffered = [];
    
      for(var i in products) {
        req.session.supplier.productsServicesOffered.push(products[i].productName);
      }
    
      var success = search(req.session.flash, 'success'), error = search(req.session.flash, 'error');
      req.session.flash = [];
      
      res.render("supplier/profile", {
        products: products,
        MAX_PROD: process.env.SUPP_MAX_PROD,
        DEFAULT_CURR: process.env.SUPP_DEFAULT_CURR,
        successMessage: success,
        errorMessage: error,
        profile: req.session.supplier
      });
    })
    .catch(console.error);
}


exports.getBidRequests = (req, res) => {
  const supplier = req.session.supplier;
  var success = search(req.session.flash, 'success'), error = search(req.session.flash, 'error');
  req.session.flash = [];

  BidRequest.find({ supplier: supplier._id })
    .then(requests => {
      res.render("supplier/bid-requests", {
        successMessage: success,
        errorMessage: error,
        supplier: supplier,
        requests: requests
      });
    })
    .catch(console.error);
};


exports.getBalance = (req, res) => {
  res.render("supplier/balance", { 
    balance: req.session.supplier.balance,
    appId: process.env.EXCH_RATES_APP_ID,
    currency: req.session.supplier.currency
  });
}


exports.getBidRequest = (req, res) => {
  const supplier = req.session.supplier;
  let request;
  const id = req.params.id;
  var success = search(req.session.flash, 'success'), error = search(req.session.flash, 'error');
  req.session.flash = [];

  BidRequest.findOne({ _id: id })
    .then( (reqresult) => {
      request = reqresult;
      return Buyer.findOne({ _id: request.buyer });
    })
    .then((buyer) => {
    var promise = BidStatus.find({}).exec();
    promise.then((statuses) => {
      res.render("supplier/bid-request", {
        supplier: supplier,
        request: request,
        buyer: buyer,
        successMessage: success,
        errorMessage: error,
        statuses: statuses,
        statusesJson: JSON.stringify(statusesJson)
        });
      });
    })
    .catch(console.error);
}


exports.postBidRequest = (req, res) => {
  MongoClient.connect(URL, {useUnifiedTopology: true}, async function(err, db) {
    if(treatError(req, res, err, 'back'))
      return false;
    var dbo = db.db(BASE);
    
    await dbo.collection("bidrequests").updateOne({ _id: req.body.reqId }, { $set: {status: req.body.status} }, function(err, res) {
      if(treatError(req, res, err, 'back'))
        return false;
      req.flash('success', 'Bid status updated successfully!');
      return res.redirect('/supplier/index');
    });
    
    db.close();
  });
 }


exports.postProfile = async (req, res) => {
  global = 0;
  
  try {
  await Supplier.findOne({ _id: req.body._id }, async (err, doc) => {
    if(treatError(req, res, err, '/supplier/profile'))
      return false;

    doc._id = req.body._id;
    doc.avatar = req.body.avatar;
    doc.role = req.body.role;
    doc.companyName = req.body.companyName;
    doc.directorsName = req.body.directorsName;
    doc.contactName = req.body.contactName;
    doc.title = req.body.title;
    doc.emailAddress = req.body.emailAddress;
    doc.password = req.body.password;
    doc.isVerified = true;
    doc.isActive = true;
    doc.companyRegistrationNo = req.body.companyRegistrationNo;
    doc.registeredCountry = req.body.registeredCountry;
    doc.balance = req.body.balance;
    doc.currency = req.body.currency;
    doc.companyAddress = req.body.companyAddress;
    doc.areaCovered = req.body.areaCovered;
    doc.contactMobileNumber = req.body.contactMobileNumber;
    doc.country = req.body.country;
    doc.industry = req.body.industry;
    doc.employeeNumbers = req.body.employeeNumbers;
    doc.lastYearTurnover = req.body.lastYearTurnover;
    doc.website = req.body.website;    
    doc.productsServicesOffered = prel(req.body.productsServicesOffered);
    doc.pricesList = prel(req.body.pricesList);
    doc.currenciesList = prel(req.body.currenciesList);
    doc.capabilityDescription = req.body.capabilityDescription;
    doc.relevantExperience = req.body.relevantExperience;
    doc.supportingInformation = req.body.supportingInformation;
    doc.certificates = req.body.certificatesIds;
    doc.antibriberyPolicy = req.body.antibriberyPolicyId;
    doc.environmentPolicy = req.body.environmentPolicyId;
    doc.qualityManagementPolicy = req.body.qualityManagementPolicyId;
    doc.occupationalSafetyAndHealthPolicy = req.body.occupationalSafetyAndHealthPolicyId;
    doc.otherRelevantFiles = req.body.otherRelevantFilesIds;
    doc.certificatesIds = req.body.certificatesIds;
    doc.antibriberyPolicyId = req.body.antibriberyPolicyId;
    doc.environmentPolicyId = req.body.environmentPolicyId;
    doc.qualityManagementPolicyId = req.body.qualityManagementPolicyId;
    doc.occupationalSafetyAndHealthPolicyId = req.body.occupationalSafetyAndHealthPolicyId;
    doc.otherRelevantFilesIds = req.body.otherRelevantFilesIds;
    doc.facebookURL = req.body.facebookURL;
    doc.instagramURL = req.body.instagramURL;
    doc.twitterURL = req.body.twitterURL;
    doc.linkedinURL = req.body.linkedinURL;
    doc.otherSocialMediaURL = req.body.otherSocialMediaURL;
    doc.UNITETermsAndConditions = req.body.UNITETermsAndConditions == "on" ? true : false;
    doc.antibriberyAgreement = req.body.antibriberyAgreement == "on" ? true : false;
    doc.createdAt = req.body.createdAt;
    doc.updatedAt = Date.now();
    //doc.__v = 1;//Last saved version. To be taken into account for future cases of concurrential changes, in case updateOne does not protect us from that problem.
    var price = req.body.price;
    //console.log(doc);
    
    if(global++ < 1)
    await MongoClient.connect(URL, {useUnifiedTopology: true}, async function(err, db) {
      if(treatError(req, res, err, '/supplier/profile'))
        return false;
      
      var dbo = db.db(BASE);
      
      await dbo.collection("suppliers").updateOne({ _id: doc._id }, { $set: doc }, function(err, resp0) {
        if(treatError(req, res, err, '/supplier/profile'))
          return false;
      });

      console.log("Supplier updated!");
      var arr = doc.productsServicesOffered;
      await dbo.collection("capabilities").deleteMany({ supplier: doc._id }, (err, resp1) => {
        if(treatError(req, res, err, '/supplier/profile'))
          return false;

        var capability = new Capability({
        supplier: doc._id,
        capabilityDescription: doc.capabilityDescription,
        createdAt: Date.now(),
        updatedAt: Date.now()
      });

      capability.save((err) => {
        if(treatError(req, res, err, '/supplier/profile'))
          return false;
      });

       console.log('Capability description saved!');
    });
      
      var industry = new Industry({
        name: doc.industry
      });

      industry.save((err) => {
        if(treatError(req, res, err, '/supplier/profile'))
          return false;
      });
      
      console.log('Now saving new data to session:');
      req.session.supplier = doc;
      req.session.supplierId = doc._id;
      await req.session.save((err) => {
        if(treatError(req, res, err, '/supplier/profile'))
          return false;
      });   
     
      await dbo.collection("productservices").deleteMany({ supplier: doc._id }, (err, resp2) => {
        if(treatError(req, res, err, '/supplier/profile'))
          return false;
        
      if (Array.isArray(arr))
        for (var i in arr) {
          if(!doc.pricesList[i]) 
            continue;

          var productService = new ProductService({
            supplier: doc._id,
            productName: arr[i],
            price: parseFloat(doc.pricesList[i]),
            currency: doc.currenciesList[i],
            createdAt: Date.now(),
            updatedAt: Date.now()
          });

          productService.save((err) => {
            if(treatError(req, res, err, '/supplier/profile'))
              return false;
          });
          
          console.log('Product saved!');
        }
        
        console.log('Products offered list saved!');
        console.log("User updated and session saved!");
        db.close();
        setTimeout(function() {
          req.flash("success", "Supplier details updated successfully!");
          console.log('Supplier details updated successfully!');
          return res.redirect("/supplier/profile");
        }, 400);
      });
    });
    })
    //.catch(console.error);
  } catch {
    //return res.redirect("/supplier/profile");
  }
};
