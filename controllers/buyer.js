const crypto = require('crypto');
const express = require("express");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const Token = require('../models/buyerToken');
const assert = require('assert');
const process = require('process');
const Schema = mongoose.Schema;
const Message = require("../models/message");
const Buyer = require("../models/buyer");
const Supervisor = require("../models/supervisor");
const Supplier = require("../models/supplier");
const BidRequest = require("../models/bidRequest");
const BidStatus = require("../models/bidStatus");
const ProductService = require("../models/productService");
const async = require('async');
const MongoClient = require('mongodb').MongoClient;
const ObjectId = require("mongodb").ObjectId;
const URL = process.env.MONGODB_URI, BASE = process.env.BASE;
const treatError = require('../middleware/treatError');
const { sendConfirmationEmail, sendCancellationEmail, sendInactivationEmail, resendTokenEmail, sendForgotPasswordEmail, sendResetPasswordEmail, sendCancelBidEmail, postSignInBody } = require('../public/templates');

const statusesJson = {
  BUYER_REQUESTED_BID: parseInt(process.env.BUYER_REQ_BID),
  WAIT_BUYER_PROCESS_INFO: parseInt(process.env.BUYER_PROC_INFO),
  BUYER_WANTS_FOR_PRICE: parseInt(process.env.BUYER_ACCEPT_PRICE),
  SUPP_STARTED_DELIVERY: parseInt(process.env.SUPP_START_DELIVERY),
  PAYMENT_DELIVERY_DONE: parseInt(process.env.PAYMENT_DELIVERY_DONE),
  SUPPLIER_CANCELS_BID: parseInt(process.env.SUPP_CANCEL_BID),
  BUYER_CANCELS_BID: parseInt(process.env.BUYER_CANCEL_BID)
};


exports.getIndex = async (req, res) => {
     if(req.session) {
      res.render("buyer/index", {
        message: req.flash('info', 'Please wait while we are loading the list of available products (The Catalog)...'),
        buyer: req.session? req.session.buyer : null,
        successMessage: req.flash('success'),
        errorMessage: req.flash('error'),
        suppliers: null
        //catalogItems: catalogItems
      });
    }
}

exports.postIndex = (req, res) => {
  if (req.body.capabilityInput) {//req.term for Autocomplete
    const key = req.body.capabilityInput;

    Supplier.find({}, (err, suppliers) => {
      treatError(req, res, err, 'buyer/index');

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
      
    var promise = BidStatus.find({}).exec();
    promise.then((statuses) => {
        res.render("buyer/index", {
          buyer: req.session.buyer,
          suppliers: suppliers2,
          MAX_PROD: process.env.BID_MAX_PROD,
          statuses: statuses,
          successMessage: req.flash('success'),
          errorMessage: req.flash('error'),
          statusesJson: JSON.stringify(statusesJson)
        });
      });
    });
  } else if (req.body.itemDescription) {//New Bid Request
    var productList = (req.body.productsServicesOffered);
    var amountList = (req.body.amountList);
    var priceList = (req.body.priceList);
    
    productList = productList.split(',');
    amountList = amountList.split(',');
    priceList = priceList.split(',');
    
    var products = [];
    
    for(var i in productList) {
      products.push('Product name: \'' + productList[i] + '\', amount: ' + parseInt(amountList[i]) + ', price: ' + parseFloat(priceList[i]) + '.');
    }
    
    const bidRequest = new BidRequest({
      requestName: req.body.requestName,
      supplierName: req.body.supplierName,
      buyerName: req.body.buyerName,
      buyerEmail: req.body.buyerEmail,
      supplierEmail: req.body.supplierEmail,
      itemDescription: req.body.itemDescription,
      productsServicesOffered: req.body.productsServicesOffered,
      amountList: req.body.amountList,
      priceList: req.body.priceList,
      orderedProducts: products,
      itemDescriptionLong: req.body.itemDescriptionLong,
      itemDescriptionUrl: req.itemDescriptionUrl,
      amount: req.body.amount,
      deliveryLocation: req.body.deliveryLocation,
      deliveryRequirements: req.body.deliveryRequirements,
      complianceRequirements: req.body.complianceRequirements,
      complianceRequirementsUrl: req.body.complianceRequirementsUrl,
      otherRequirements: req.body.otherRequirements,
      status: req.body.status,
      price: req.body.price,
      isCancelled: false,
      currency: req.body.currency,
      specialMentions: req.body.specialMentions? 
        req.body.specialMentions 
          : req.body.buyerName + ' has sent a new Order to ' + req.body.supplierName + ', and the price is ' + req.body.price + ' ' + req.body.currency + '.',
      createdAt: req.body.createdAt? req.body.createdAt : Date.now(),
      updatedAt: Date.now(),
      buyer: req.body.buyer,
      supplier: req.body.supplier
    });

    return bidRequest
      .save()
      .then((err, result) => {
        treatError(req, res, err, 'buyer/index');
        req.flash("success", "Bid requested successfully!");
        return res.redirect("/buyer/index");
      })
      .catch(console.error);
  } else {
    res.redirect("/buyer");
  }
}


exports.getChatLogin = (req, res) => {//We need a username, a room name, and a socket-based ID.
  res.render("buyer/chatLogin", {
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


exports.getViewBids = (req, res) => {
  var promise = BidRequest.find({supplier: req.params.supplierId, buyer: req.params.buyerId}).exec();
  
  promise.then((bids) => {
    res.render("buyer/viewBid", {
      bids: bids? bids : [],
      stripePublicKey: process.env.STRIPE_KEY_PUBLIC,
      stripeSecretKey: process.env.STRIPE_KEY_SECRET,
      successMessage: req.flash('success'),
      errorMessage: req.flash('error'),
      statusesJson: JSON.stringify(statusesJson),
      supplierId: req.params.supplierId, 
      buyerId: req.params.buyerId
    });
  });
}


exports.postViewBids = (req, res) => {
  MongoClient.connect(URL, {useUnifiedTopology: true}, function(err, db) {//db or client.
      treatError(req, res, err, 'back');
    
      var dbo = db.db(BASE);
      dbo.collection("bidrequests").updateOne({ _id: req.body.id }, { $set: {status: req.body.status} }, function(err, resp) {
        treatError(req, res, err, 'back');
        req.flash('success', 'Bid status updated successfully!');        
        db.close();
        res.redirect('back');
    });
  });  
}


exports.getCancelBid = (req, res) => {
  res.render('buyer/cancelBid', {
    successMessage: req.flash('success'),
    errorMessage: req.flash('error'),
    bidId: req.params.bidId,
    bidName: req.params.bidName,
    userType: req.params.userType,
    buyerName: req.params.buyerName,
    supplierName: req.params.supplierName,
    buyerEmail: req.params.buyerEmail,
    supplierEmail: req.params.supplierEmail
  });
}


exports.postCancelBid = (req, res) => {
  try {
  MongoClient.connect(URL, {useUnifiedTopology: true}, async function(err, db) {
    treatError(req, res, err, 'back');
    var dbo = db.db(BASE);

    try {
      await dbo.collection('bidcancelreasons').insertOne( {
        title: req.body.reasonTitle,//Radio!
        userType: req.body.userType,
        reason: req.body.reason,
        userName: req.body.buyersName,
        createdAt: Date.now()
      }, function(err, obj) {
          treatError(req, res, err, 'back');
      });
    }
    catch(e) {
      console.error(e);
    }

    await dbo.collection("bidrequests").updateOne({ _id: new ObjectId(req.body.bidId) }, { $set: {isCancelled: true, status: parseInt(process.env.BUYER_BID_CANCEL)} }, async function(err, resp) {
      treatError(req, res, err, 'back');      
      await sendCancelBidEmail(req, req.body.suppliersName, req.body.buyersName, req.body.suppliersEmail, req.body.buyersEmail, 'Supplier ', 'Buyer ', req.body.reason);
      db.close();
      res.redirect('back');
      });
    });
  } catch {
    //res.redirect('/buyer/index');
  }
}

exports.getConfirmation = (req, res) => {
    if(!req.session || !req.session.buyerId) {
    req.session = req.session? req.session : {};
    req.session.buyerId = req.params && req.params.token? req.params.token._userId : null;
  }
  
  res.render('buyer/confirmation', { 
    token: req.params? req.params.token : null 
  });
}

exports.getDelete = (req, res) => {
  res.render('buyer/delete', {
    id: req.params.id,
    successMessage: req.flash('success'),
    errorMessage: req.flash('error')
  });
}

exports.getDeactivate = (req, res) => {
  res.render('buyer/deactivate', {
    id: req.params.id,
    successMessage: req.flash('success'),
    errorMessage: req.flash('error')
  });
}

exports.getResendToken = (req, res) => {
  res.render('buyer/resend', {
    successMessage: req.flash('success'),
    errorMessage: req.flash('error')
  });
}


async function removeAssociatedBids(req, res, dbo, id) {
  var promise = BidRequest.find( { buyer: id } ).exec();
  await promise.then(async (bids) => {
    var complexReason = 'The Buyer deleted their account. More details:\n' + req.body.reason;

    for(var bid of bids) {//One by one.
      try {
        await dbo.collection('bidcancelreasons').insertOne( {
          title: 'User Cancellation',
          userType: req.body.userType,
          reason: complexReason,
          userName: req.body.organizationName,
          createdAt: Date.now()
        }, function(err, obj) {
          treatError(req, res, err, 'back');
        });
      }  
      catch(e) {
        treatError(req, res, e, 'back');
      }

      await dbo.collection('bidrequests').deleteOne( { _id: bid._id }, function(err, obj) {
        treatError(req, res, err, 'back');
      });

      req.body.requestsName = bid.requestName;
      await sendCancelBidEmail(req, bid.suppliersName, bid.buyersName, bid.suppliersEmail, bid.buyersEmail, 'Supplier ', 'Buyer ', complexReason);
    }
  });
}


exports.postDelete = async function (req, res, next) {  
  var id = req.body.id;
  try {    
    MongoClient.connect(URL, {useUnifiedTopology: true}, async function(err, db) {
      var dbo = db.db(BASE);
      //A Reason why the User is deleted.
      try {
        await dbo.collection('usercancelreasons').insertOne( {
          title: req.body.reasonTitle,
          reason: req.body.reason,
          userType: req.body.userType,
          userName: req.body.organizationName,
          createdAt: Date.now()
        }, function(err, obj) {
          treatError(req, res, err, 'back');
        });
      } catch(e) {
        console.error(e);
        req.flash('error', e.message);
      }
      
      //Delete Buyer's Bid Requests first:
      await removeAssociatedBids(req, res, dbo, id);

      //Now delete the messages sent or received by Buyer:
      await dbo.collection('messages').deleteMany({ $or: [ { from: id }, { to: id } ] }, function(err, resp0) {
        treatError(req, res, err, 'back');
      });

      //Remove the possibly existing Buyer Tokens:
      await dbo.collection('buyertokens').deleteMany({ _userId: id }, function(err, resp1) {
        treatError(req, res, err, 'back');
      });

      //And now, remove the Buyer themselves:
      await dbo.collection('buyers').deleteOne({ _id: id }, function(err, resp2) {
        treatError(req, res, err, 'back');
      });
    //Finally, send a mail to the ex-Buyer:
    sendCancellationEmail('Buyer', req, 'placed orders, sent/received messages', req.body.reason);
    db.close();
    req.flash('success', 'You have deleted your Buyer account. We hope that you will be back with us!');
    res.redirect("/buyer/sign-in");
    });
  } catch {
    //res.redirect("/buyer");
  }
}


exports.postDeactivate = async function (req, res, next) {  
  var id = req.body.id;
  try {//Firstly, a Reason why deactivating the account:
    MongoClient.connect(URL, {useUnifiedTopology: true}, async function(err, db) {
      var dbo = db.db(BASE);
      /*
      try {
        await dbo.collection('cancelreasons').insertOne( {
          type: req.body.type,
          reason: req.body.reason,
          userType: req.body.userType,
          userName: req.body.organizationName,
          createdAt: Date.now()
        }, function(err, obj) {});
      } catch(e) {
        console.error(e);
      }*/
      
      //Delete Buyer's Bid Requests first:
      await removeAssociatedBids(req, dbo, id);

      //And now, remove the Buyer themselves:
      await dbo.collection('buyers').updateOne({ _id: id }, { $set: { isActive: false } }, function(err, resp2) {
        treatError(req, res, err, 'back');
      });
    //Finally, send a mail to the ex-Buyer:
    await sendCancellationEmail('Buyer', req, 'placed orders', req.body.reason);
    db.close();
    req.flash('success', 'You have deactivated your Buyer account. Logging in will reactivate you.');
    res.redirect("/buyer/sign-in");
    });
  } catch {
  }
}


exports.postConfirmation = async function (req, res, next) {
  try {
  await Token.findOne({ token: req.params.token }, async function (err, token) {
      if (!token) {
        req.flash('We were unable to find a valid token. It may have expired. Please request a new token.');
        res.redirect('/buyer/resend');
        if(1==2) 
          return res.status(400).send({
          type: 'not-verified', 
          msg: 'We were unable to find a valid token. Your token may have expired.' });
      }

      await Buyer.findOne({ _id: token._userId, emailAddress: req.body.emailAddress }, async function (err, user) {
          if (!user) 
            return res.status(400).send({
            msg: 'We were unable to find a user for this token.' 
          });

          if(user.isVerified) 
            return res.status(400).send({ 
            type: 'already-verified', 
            msg: 'This user has already been verified.' });           

            await MongoClient.connect(URL, {useUnifiedTopology: true}, async function(err, db) {
                  treatError(req, res, err, 'back');
                    
                  var dbo = db.db(BASE);
                  await dbo.collection("buyers").updateOne({ _id: user._id }, { $set: { isVerified: true, isActive: true } }, function(err, resp) {
                    if(err) {
                      console.error(err.message);
                      return res.status(500).send({ 
                        msg: err.message 
                      });
                    }
                  });
              
              db.close();
              console.log("The account has been verified. Please log in.");
              req.flash('success', "The account has been verified. Please log in.");
              res.redirect('/buyer/sign-in/');
              //res.status(200).send("The account has been verified. Please log in.");
            });        
          });
    });
  } catch {
  }
}


exports.postResendToken = function (req, res, next) {/*
    req.assert('emailAddress', 'Email is not valid').isEmail();
    req.assert('emailAddress', 'Email cannot be blank').notEmpty();
    req.sanitize('emailAddress').normalizeEmail({ remove_dots: false });   
    var errors = req.validationErrors();
    if (errors) return res.status(400).send(errors);*/
 
    Buyer.findOne({ emailAddress: req.body.emailAddress }, function (err, user) {
        if (!user) 
          return res.status(400).send({ msg: 'We were unable to find a user with that email.' });
        if (user.isVerified) 
          return res.status(400).send({ msg: 'This account has already been verified. Please log in.' });
 
        var token = new Token({ 
          _userId: user._id, 
          token: crypto.randomBytes(16).toString('hex') });
 
        token.save(async function (err) {
            if (err) {
              req.flash('error', err.message);
              return res.status(500).send({
                msg: err.message 
              }); 
            }
          
            await resendTokenEmail(user, token.token, '/buyer/confirmation/', req);
            return res.status(200).send('A verification email has been sent to ' + user.emailAddress + '.');
        });
  });
}


exports.getSignIn = (req, res) => {
  if (!req.session.buyerId || !req.session.buyer.isVerified)
    res.render("buyer/sign-in", {
      successMessage: req.flash('success'),
      errorMessage: req.flash("error")
    });
  else res.redirect("/buyer");
}


exports.getSignUp = (req, res) => {
  if (!req.session.buyerId)
    return res.render("buyer/sign-up", {
      successMessage: req.flash('success'),
      errorMessage: req.flash("error")
    });
  else res.redirect("/buyer");
}


exports.getBalance = (req, res) => {
  res.render("buyer/balance", { balance: req.session.buyer.balance });
}


exports.getForgotPassword = (req, res) => {
  res.render("buyer/forgotPassword", {
    email: req.session.buyer.emailAddress,
    successMessage: req.flash('success'),
    errorMessage: req.flash('error')
  });
}


exports.postForgotPassword = (req, res, next) => {
  async.waterfall([
    function(done) {
      crypto.randomBytes(20, function(err, buf) {
        var token = buf.toString('hex');
        done(err, token);
      });
    },
    function(token, done) {
      Buyer.findOne({ emailAddress: req.body.emailAddress }, function (err, user) {
        if (!user) {
          req.flash('error', 'Sorry. We were unable to find a user with this e-mail address.');
          return res.redirect('buyer/forgotPassword');
        }
        
        MongoClient.connect(URL, {useUnifiedTopology: true}, function(err, db) {
          treatError(req, res, err, 'back');
          
          var dbo = db.db(BASE);
          dbo.collection("buyers").updateOne({ _id: user._id }, { $set: {resetPasswordToken: token, resetPasswordExpires: Date.now() + 86400000} }, function(err, resp) {        
            if(err) {
              console.error(err.message);
              req.flash('error', err.message);
              return false;
            }

            db.close();
          });
        });
      });
    },
    function(token, user, done) {
      sendForgotPasswordEmail(user, 'Buyer', "/buyer/reset/", token, req);
    }
  ], function(err) {
    if(err) {
      req.flash('error', err.message);
      return next(err);
    }
      res.redirect('/buyer/forgotPassword');
  });
}


exports.getResetPasswordToken = (req, res) => {
  Buyer.findOne({resetPasswordToken: req.params.token, resetPasswordExpires: { $gt: Date.now() }}, function(err, user) {
    if(!user) {
      req.flash('error', 'Password reset token is either invalid or expired.');
      return res.redirect('/forgotPassword');
    }
    res.render('buyer/resetPassword', {token: req.params.token});
  });
}


exports.postResetPasswordToken = (req, res) => {
  async.waterfall([
    function(done) {
      Buyer.findOne({resetPasswordToken: req.params.token, 
                     resetPasswordExpires: { $gt: Date.now() }
                    }, function(err, user) {
      if(!user) {
        req.flash('error', 'Password reset token is either invalid or expired.');
        return res.redirect('back');
      }
        
    if(req.body.password === req.body.confirm) {
      MongoClient.connect(URL, {useUnifiedTopology: true}, function(err, db) {
        if (err) throw err;
        var dbo = db.db(BASE);
        dbo.collection("buyers").updateOne({ _id: user._id }, { $set: {password: req.body.password, resetPasswordToken: undefined, resetPasswordExpires: undefined} }, function(err, resp) {        
          treatError(req, res, err, 'back');
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
      sendResetPasswordEmail(user, 'Buyer', req);
    }
  ], function(err) {
      treatError(req, res, err, 'back');
      res.redirect('/buyer');
    });
}


exports.postSignIn =  (req, res) => {
  postSignInBody('buyer', req, res);
}


let global = 0;
function getSupers(id) {
  var promise = Supervisor.find({organizationUniteID: id}).exec();
  return promise;
}

exports.postSignUp = async (req, res) => {
  if (req.body.emailAddress) {
    const email = req.body.emailAddress;
    const email_str_arr = email.split("@");
    const domain_str_location = email_str_arr.length - 1;
    const final_domain = email_str_arr[domain_str_location];
    var prohibitedArray = ["gmaid.com", "hotmaix.com", "outloop.com", "yandex.com", "yahuo.com", "gmx"];
    console.log(final_domain.toLowerCase());
    for(var i = 0; i < prohibitedArray.length; i++)
    if (final_domain.toLowerCase().includes(prohibitedArray[i].toLowerCase())) {
      req.flash("error", "E-mail address must be a custom company domain.");
      res.redirect("/buyer/sign-up");
    } else {
      if (req.body.password.length < 6) {
        req.flash("error", "Password must have at least 6 characters.");
        res.redirect("/buyer/sign-up");
      } else {
        var promise = getSupers(req.body.organizationUniteID);
        
        promise.then(async function(supers) {
          if((1==2) && (!supers || supers.length == 0)) {
            req.flash("error", "Invalid UNITE ID. Please select an appropriate ID from the list.");
            res.redirect("/buyer/sign-up");
          } else if(global++ < 1) {console.log(global);
          await Buyer.findOne({ emailAddress: req.body.emailAddress }, function (err, user) {
            if (user)
              res.status(400).send({ msg: 'The e-mail address you have entered is already associated with another account.'});
            var buyer;
        try {
          bcrypt.hash(req.body.password, 16, async function(err, hash) {
              console.log(hash);
            
              buyer = new Buyer({
                role: process.env.USER_REGULAR,
                avatar: req.body.avatar,
                organizationName: req.body.organizationName,
                organizationUniteID: req.body.organizationUniteID,
                contactName: req.body.contactName,
                emailAddress: req.body.emailAddress,
                password: req.body.password,          
                isVerified: false,
                isActive: false,
                contactMobileNumber: req.body.contactMobileNumber,
                address: req.body.address,
                balance: req.body.balance,
                deptAgencyGroup: req.body.deptAgencyGroup,
                qualification: req.body.qualification,
                country: req.body.country,
                createdAt: Date.now(),
                updatedAt: Date.now()
              });

              await buyer.save((err) => {
                treatError(req, res, err, '/buyer/sign-up');
              });
                
              req.session.buyer = buyer;
              req.session.buyerId = buyer._id;
              await req.session.save((err) => {
                treatError(req, res, err, '/buyer/sign-up');
                });

              var token = new Token({ 
                _userId: buyer._id,
                token: crypto.randomBytes(16).toString('hex')
              });

              await token.save( async function (err) {
                if (err) {
                  req.flash('error', err.message);
                  console.error(err.message);
                  res.status(500).send({
                    msg: err.message 
                 });
                }
              });
              
              await sendConfirmationEmail(req.body.organizationName, "/buyer/confirmation/", token.token, req);
              req.flash("success", "Buyer signed up successfully! Please confirm your account by visiting " + req.body.emailAddress + '');
              setTimeout(function() {
                res.redirect("/buyer/sign-in");
              }, 150);
              });
            } catch {
            }
            });
          }
        })//.catch(console.error);
      }
    }
  }
}


exports.getProfile = (req, res) => {
  res.render("buyer/profile", {
    successMessage: req.flash('success'),
    errorMessage: req.flash("error"),
    profile: req.session.buyer
  });
};

exports.postProfile = (req, res) => {
  try {
    Buyer.findOne({ _id: req.body._id }, (err, doc) => {
      treatError(req, res, err, '/buyer/profile');
      
      doc._id = req.body._id;
      doc.avatar = req.body.avatar;
      doc.role = req.body.role;
      doc.organizationName = req.body.organizationName;
      doc.organizationUniteID = req.body.organizationUniteID;
      doc.contactName = req.body.contactName;
      doc.emailAddress = req.body.emailAddress;
      doc.password = req.body.password;
      doc.isVerified = true;
      doc.isActive = true;
      doc.contactMobileNumber = req.body.contactMobileNumber;
      doc.address = req.body.address;
      doc.balance = req.body.balance;
      doc.deptAgencyGroup = req.body.deptAgencyGroup;
      doc.qualification = req.body.qualification;
      doc.country = req.body.country;
      doc.createdAt = req.body.createdAt;
      doc.updatedAt = Date.now();

      MongoClient.connect(URL, {useUnifiedTopology: true}, async function(err, db) {
        treatError(req, res, err, '/buyer/profile');
        var dbo = db.db(BASE);
        
        await dbo.collection("buyers").updateOne({ _id: doc._id }, { $set: doc }, async function(err, resp) {
          treatError(req, res, err, '/buyer/profile');

          req.session.buyer = doc;
          req.session.buyerId = doc._id;
          await req.session.save();
          db.close();
          
          console.log('Buyer details updated successfully!');
          setTimeout(function() {
            req.flash("success", "Buyer details updated successfully!");
            res.redirect("/buyer/profile");
          }, 150);
        });
      });
    })    
      //.catch(console.error);
  } catch {
  //res.redirect('/buyer/profile');
  }
}