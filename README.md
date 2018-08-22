# battleship.io
This is a multiplayer online game, to install for testing purpose locally, from command line, run 

`git clone https://github.com/OkJoe/battleship.io.git` 

`cd battleship.io` 

`node app.js` 

Then open http://localhost:3000/ in any browser (chrome recommended). 

------------------------------Game Introduction------------------------------

You will first be directed to a signup page, simply enter a nickname and enter game. 

You will be able to control your ship with "adws" keys, a speed figure is shown bottom left, which shows the status of your engine and rudder status along with the actual relative velocity. 

The ship is initialized with an engine only and two components only, you will need to add more components and/or modules to enjoy their features. To do so, press alt and any number key to select a component (counted from bow to aft). Once a component is selected, click the 'component' text on the left to add a component before it, or click a module name to add it onto the selected component. 

You will also be able to upgrade the attributes of the ship from the left panel. Upgrading and adding modules will consume 'level points.' The each upgrade or module will consume one level points, with the exception of the followings: [gunmult (the # of guns per turret), torpmult (the # of torpedo tubes per launcher)], which consume two level points each. 

You can select weapons to use with number keys. Instructions for each weapon is listed as follows: 

Guns: click anywhere on map to shoot at that position. alternatively, shift click any ship to select as enemy, the use the scope appeared on upper right to shoot more accurately. 

Torpedo Launchers: use shift to select a launcher, then click to launch torpedoes. 

Minelayers: click to lay mines directly below the ship, be ready to leave because the mine will detonate once the timer is up. 

etc........................

The damage received is indicated by the color of the components, which grows redder as the component receives more damage. The component and all its modules will be disabled if the HP drops to zero, as indicated by the module turning pure red. 

This is a preliminary version of the game, you are welcomed to email suggestions to ilestcree@gmail.com. 