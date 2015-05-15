# ChipsAndGuac

![](img/chipsandguac.jpg)

Node.js API for programmatically ordering from the Chipotle website. This module can be used for locating nearby Chipotle restaurants, looking up favorite and recent orders, checking available pickup times, and of course, placing orders. 

### Usage

```javascript
var ChipsAndGuac = require('chipsandguac')

// instantiate a new ChipsAndGuac object, passing in required configuration and credentials.
var cag = new ChipsAndGuac({
  email:'EMAIL_GOES_HERE', 
  password:'PASSWORD_GOES_HERE', 
  locationId: 'LOCATION_ID', 
  phoneNumber:'555.555.5555' // must match user profile
});
```

#### Find nearby locations (useful for getting location ID above)
```javascript
cag.getNearbyLocations("80123").then(function(locations) {
  console.log(JSON.stringify(locations));
});

// output (Array)
[ 
  { id: 1430, name: '8100 W. Crestline Ave' },
  { id: 644, name: '3170 S. Wadsworth' },
  { id: 970, name: '5699 S. Broadway' },
  { id: 71, name: '12512 W. Ken Caryl Ave.' },
  { id: 390, name: '333 W. Hampden Ave.' } 
]
```

#### Look up recent orders (useful for getting previous order ID)
```javascript
cag.getOrders().then(function(orders) {
  console.log(orders);
});

// output (Array)
[
  {
    "id": 123456789,
    "name":"Recent Order #1",
    "items":[
      {
        "name":"1 x Chicken Burrito Bowl",
        "details":"Brown Rice, Black Beans, Extra Chicken, Fresh Tomato Salsa, Tomatillo-Red Chili Salsa, Cheese"
      }
    ]
  }
]
```

#### Place an order (using a previous order ID)
Note: passing `true` for the second argument in this call will NOT place an order. This is useful for previewing the order and looking up the next available pickup time. If this parameter is left off, or if `false` is passed, the order WILL be placed.
```javascript
cag.submitPreviousOrderWithId(123456789, true).then(function(orderDetails) {
  console.log(orderDetails);
});

// output
{
  pickupTimes: [ '5/14/2015 9:30:00 PM', '5/14/2015 9:45:00 PM' ],
  items:
   [ { name: 'Your Name',
       itemName: 'Chicken Burrito Bowl',
       itemDetails: '...' }],
  location: '8100 W Crestline Ave, Denver, CO 80123' 
}
```

