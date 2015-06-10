var cheerio = require('cheerio'),
    Promise = require("bluebird"),
    request = require("request");

const BASE_ORDER_URL = 'https://order.chipotle.com';

/*
  ChipsAndGuac
  This module handles all requests to the restaurant website.
*/
function ChipsAndGuac(options) {
  if (!options) {
    throw new Error('options object was empty.');
  }

  this._email = options.email;
  this._password = options.password;
  this._locationId = options.locationId;
  this._phoneNumber = options.phoneNumber;
  this._currentOrderId = 0;
  this._cookieStore = request.jar();  // cookie jar per instance, and request per instance
  this.request = Promise.promisifyAll(request.defaults({jar: this._cookieStore, followRedirect: false}));
};

/*
  Initializes the current order by cancelling any existing order on the user's profile.
*/
ChipsAndGuac.prototype.initOrder = function() {
  var self = this;
  if(self._currentOrderId !== 0) {
    return Promise.resolve();
  } else {
    return self.getAddToOrderToken()
      .then(function(token) {
        return self.request.postAsync({ 
          uri: BASE_ORDER_URL + '/Order/CancelOrder', 
          json: true, 
          headers: {'RequestVerificationToken':token}
        })
        .spread(bodyOrError)
        .then(function(body) {
          console.log('order initialized');
        });
      });
  }
};

/*
  Static method to retrieve nearby restaurant locations using a zipcode
  @param {number} zipcode - US zip to find locations near.
*/
ChipsAndGuac.getNearbyLocations = function(zip) {
  var self = {};
  self._cookieStore = request.jar();
  self.request = Promise.promisifyAll(request.defaults({jar: self._cookieStore, followRedirect: false}));
  return self.request.getAsync({uri: BASE_ORDER_URL})
    .spread(bodyOrError)
    .then(getActionToken)
    .then(function(token) {
      return self.request.postAsync({ 
        uri: BASE_ORDER_URL, 
        headers: {'RequestVerificationToken':token},
        formData: {'PartialAddress': zip}
      });
    })
    .spread(bodyOrError)
    .then(function(html) {
      var locations = [];
      $ = cheerio.load(html);
      $("div.dvRestaurant").each(function() {
        locations.push({
          id: $("div.orderNow > a", this).data("locationid"),
          name: $("div.dvRestName", this).text()
        });
      });
      return locations;
    });
};

/*
  Retrieves favorite and recent orders from a user's profile.
*/
ChipsAndGuac.prototype.getOrders = function() {
  var self = this;
  if(!self._locationId) {
    throw new Error('unable to load orders, locationId not set.');
  }

  return self.loginIfNeeded()
    .then(function() {
      return self.request.getAsync({
        uri: BASE_ORDER_URL + '/MealAuth/Index/' + self._locationId
      });
    })
    .spread(bodyOrError)
    .then(function(html) {
      console.log('location ' + self._locationId + ' homepage success!');
      return getOrdersFromResponse(html);
    }); 
};

/*
  Places a previous order using the specified order ID.
*/
ChipsAndGuac.prototype.submitPreviousOrderWithId = function(orderId, preview, pickupTime) {
  var self = this;
  return self.addOrderToBag(orderId).then(function(orderId) {
    return self.selectPayment().then(function() {
      return self.reviewOrder().then(function(orderDetails) {
        console.log('order ready for submit.', orderDetails);

        if(!pickupTime) {
          console.log('using first available pickup time: ', orderDetails.pickupTimes[0]);
          pickupTime = orderDetails.pickupTimes[0];
        }

        if(preview) {
          console.log('preview is enabled, so skipping place order step');
          return orderDetails;
        }

        return self.placeCurrentOrder(pickupTime).then(function() {
          return {location: orderDetails.location, pickupTime: pickupTime, items: orderDetails.items};
        });
      });
    });
  });
};

/*
  Places the current order from the users session. Verifys the phone number and
  makes the final call to the website to place the order.
*/
ChipsAndGuac.prototype.placeCurrentOrder = function(pickupTime) {
  var self = this;
  return self.getPlaceOrderToken()
    .then(function(token) {
      return self.verifyPhoneNumber(token)
      .then(function() { 

        var placeOrderPayload = {
          orderId: self._currentOrderId,
          pickupTimeInterval: pickupTime,
          restaurantNumber: self._locationId
        };

        return self.request.postAsync({ 
          uri: BASE_ORDER_URL + '/PlaceOrder/Index/' + self._locationId + '/' + self._currentOrderId, 
          json: true, 
          body: placeOrderPayload, 
          headers: {'RequestVerificationToken':token}
        })
        .spread(bodyOrError)
        .then(function(body) { 
          console.log('place order response', body);
          if(body.IsSuccessful) {
            console.log('order placed successfully!');
            return;
          } else {
            throw new Error('error placing order. response: ' + body);
          }
        });

      })
    });
};

ChipsAndGuac.prototype.verifyPhoneNumber = function(token) {
  var self = this;
  if(!self._phoneNumber) {
    throw new Error('unable to verify phone number, phoneNumber not set.');
  }

  var phonePayload = {
    'phoneNumber': self._phoneNumber
  };

  return self.request.postAsync({ 
    uri: BASE_ORDER_URL + '/PlaceOrder/VerifyPhone', 
    json: true, 
    body: phonePayload, 
    headers: {'RequestVerificationToken':token}
  })
  .spread(bodyOrError)
  .then(function(body) { 
    if(body.IsSuccessful) {
      console.log('phone number verified');
    } else {
      throw new Error('error verifying phone number. validate phoneNumber correct in the config.');
    }
  });
}

/*
  Adds items from a previous order ID to a new order.
  @param {number} orderId - valid order ID to add items from.
*/
ChipsAndGuac.prototype.addOrderToBag = function(orderId) {
  var self = this;
  if(!self._locationId) {
    throw new Error('unable to add to bag, locationId not set.');
  }
  var orderPayload = {
    "pastOrderId": orderId,
    "newOrderId": 0,
    "restaurantNumber": self._locationId,
    "sendToCheckout": false
  };
  return self.initOrder()
    .then(function() {
      return self.getAddToOrderToken();
    })
    .then(function(token) {
      return self.request.postAsync({ 
        uri: BASE_ORDER_URL + '/Order/SaveOrderCopy', 
        json: true, 
        body: orderPayload, 
        headers: {'RequestVerificationToken':token}
      })
      .spread(bodyOrError)
      .then(function(body) { 
        if(body.IsSuccessful) {
          if(body.Id === 0) {
            throw new Error('error adding previous order. new order id was 0, which may mean the restaurant is closed.');
          }
          self._currentOrderId = body.Id;
          console.log('items from order %s added to order %s', orderId, self._currentOrderId);
          return self._currentOrderId;
        } else {
          throw new Error('error adding previous order.');
        }
      });
    });
};

/*
  Retrieves the request token from the order page for adding items to the bag.
*/
ChipsAndGuac.prototype.getAddToOrderToken = function() {
  var self = this;
  if(!self._locationId) {
    throw new Error('unable to get token, locationId not set.');
  }
  return self.loginIfNeeded()
    .then(function() {
      return self.request.getAsync({
        uri: BASE_ORDER_URL + '/MealAuth/Index/' + self._locationId
      })
    })
    .spread(bodyOrError)
    .then(function(html) {
      console.log('location ' + self._locationId + ' homepage success!');
      return getActionToken(html);
    });
}

/*
  Retrieves the request token from the review page for placing the order.
*/
ChipsAndGuac.prototype.getPlaceOrderToken = function() {
  var self = this;
  if(!self._locationId) {
    throw new Error('unable to get token, locationId not set.');
  }
  if(!self._currentOrderId) {
    throw new Error('unable to get token, currentOrderId not set.');
  }
  return self.request.getAsync({uri: BASE_ORDER_URL + '/PlaceOrder/Index/' + self._locationId + '/' + self._currentOrderId})
    .spread(bodyOrError)
    .then(function(html) {
      console.log('place order token success');
      return getActionToken(html);
    });
}

/*
  Selects the payment type for the order (pay in store)
*/
ChipsAndGuac.prototype.selectPayment = function() {
  var self = this;
  var payInStorePayload = {
    "restaurantNumber": self._locationId,
    "orderId": self._currentOrderId,
    "selectedCardId": "00000000-0000-0000-0000-000000000000"
  };
  return self.request.getAsync({uri: BASE_ORDER_URL + '/Payment/Index/512/' + self._currentOrderId})
    .spread(bodyOrError)
    .then(getActionToken)
    .then(function(token) {
      return self.request.postAsync({
        uri: BASE_ORDER_URL + '/Payment/Index/' + self._locationId + '/' + self._currentOrderId, 
        json: true, 
        body: payInStorePayload, 
        headers: {'RequestVerificationToken':token}
      });
    })
    .spread(bodyOrError)
    .then(function(body) {
      if(body.IsSuccessful) {
        console.log('pay in store selected');
        return true;
      } else {
        throw new Error('error selecting payment.');
      }
    });
};

/*
  Retrieves all order details and pickup times from the order review page.
*/
ChipsAndGuac.prototype.reviewOrder = function() {
  var self = this;
  var availablePickupTimesPayload = {
    "restaurantNumber":self._locationId,
    "orderId":self._currentOrderId
  };
  return self.request.getAsync({uri: BASE_ORDER_URL + '/PlaceOrder/Index/' + self._locationId + '/' + self._currentOrderId})
  .spread(bodyOrError)
  .then(function(body) {
    var token = getActionToken(body);
    var orderReviewBody = body;
    console.log('order review success');
    return self.request.postAsync({ 
      uri: BASE_ORDER_URL + '/PlaceOrder/AvailablePickupTimes', 
      json:true, 
      body: availablePickupTimesPayload, 
      headers: {'RequestVerificationToken':token}
    })
    .spread(bodyOrError)
    .then(function(body) {
      if(body.IsSuccessful) {
        console.log('pickup times found');
        return getOrderReviewInfo(orderReviewBody, body);
      } else {
        throw new Error('pickup times unavailable, message: ' + body.Message);
      }
    });
  });
};

/*
  Helper method to log the user in if they are not logged in already.
*/
ChipsAndGuac.prototype.loginIfNeeded = function() {
  var self = this;
  if(!self.isLoggedIn()) {
    return self.login();
  } else {
    console.log('logged in');
    return Promise.resolve();
  }
};

/*
  Logs the user in using the configured credentials.
*/
ChipsAndGuac.prototype.login = function() {
  var self = this;
  var authPayload = {'model':{'Email':self._email,'Password':self._password}};

  if(!self._email) {
    throw new Error('unable to login, email not set.')
  }
  
  console.log("logging in...");
  return self.request.getAsync({uri: BASE_ORDER_URL})
    .get(1)
    .then(getActionToken)
    .then(function(token) {
      return self.request.postAsync({
        uri: BASE_ORDER_URL + '/Account/LogOn',
        json:true,
        body: authPayload,
      });
    })
    .spread(bodyOrError)
    .then(function(body){
      if(body.IsSuccessful) {
        console.log('login success!');
        return;
      } else {
        throw new Error('login failed. check credentials.');
      }
    });
};

/*
  Helper method to check if the user is logged in. Checks the current cookie state for the 
  online ordering cookie.
*/
ChipsAndGuac.prototype.isLoggedIn = function() {
  var self = this;
  if(self._cookieStore.getCookieString(BASE_ORDER_URL).search("OnlineOrder3Auth1=") > 0) {
    return true;
  }
  return false;
};

/*
  Helper method to scrape order details from the order review page HTML
*/
var getOrderReviewInfo = function(reviewResponse, pickupTimesResponse) {
  $ = cheerio.load(reviewResponse);
  var order = {
    pickupTimes: [],
    items: []
  };
  
  //find pickup times
  for (var i=0; i < pickupTimesResponse.SelectList.length; i++) {
    order.pickupTimes.push(pickupTimesResponse.SelectList[i].Value);
  }

  //order items
  $("div.mealItem").each(function() {
    var item = {
      // the markup is pretty terrible
      name: $(this).parent().prev().find("div.mealName").text(),
      itemName: $("div.mealItemTitle", this).text(),
      itemDetails: $("div.mealItemDetails", this).text()
    };
    order.items.push(item);
  });

  //location
  order.location = $('#placeOrderLocation > p > span').first().text().trim().replace(/ +(?= )/g,'');

  return order;
}

/*
  Helper method to scrape favorite and recent orders from the store homepage HTML.
*/
var getOrdersFromResponse = function(response) {
  $ = cheerio.load(response);
  var orders = [];

  $("div.orderDetails").each(function() {
    var orderItems = [];
    
    $("div.orderItem", this).each(function() {
      var item = {
        name: $("div.orderItemTitle", this).text(),
        details: $("div.orderItemDetails", this).text()
      }
      orderItems.push(item);
    });

    var order = {
      id: $(this).data("orderid"),
      name: $("div.orderName", this).text(),
      items: orderItems
    }

    orders.push(order);
  });

  return orders;
};

/*
  Gets an action token from the hidden input that exists on many of of the order pages.
*/
function getActionToken(response) {
  $ = cheerio.load(response);
  return $("input[name='__RequestVerificationToken']").val();
}

/*
  Simple helper to status check the response and throw an error if it was not a 200. 
  If there was no error, returns the response body.
*/
function bodyOrError(response, body) {
  if(response.statusCode == 200) {
    return body;
  } else {
    throw new Error('request failed: '+ response.statusCode + ' body: ' + body);
  }
}

module.exports = ChipsAndGuac;

