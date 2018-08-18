var express = require('express'); 
var app = express(); 
var serv = require('http').Server(app); 

//Utility 
function mod(a,b) {
	return (a%b+b)%b; 
}; 
function angleDiffUnderPi(a,b) {
	var diff = a-b; 
	if (diff < -Math.PI) {
		return diff + 2 * Math.PI; 
	}
	else if (diff > Math.PI) {
		return diff - 2 * Math.PI; 
	}
	else {return diff; }
}; 

//Setup 

app.get('/', function(req, res) {
	res.sendFile(__dirname + '/client/index.html'); 
}); 
app.use('/client', express.static(__dirname + '/client')); 

serv.listen(3000); 
console.log('server started'); 

//Initialize basic variables 

var DEBUG = true; 

var fps = 25; 

var mapInfo = {size:{x:10000, y:10000}}; 

var physics = {
	directionRecoverFactor:1-Math.pow((1-0.9),1/fps), // 1-(1-<percentage of angle recovered per second>)^(1/fps)
	waterFrictionFactor:20/fps, // <fraction of speed lost per second per angular difference of bearing and velocity direction>/fps 
	nearDistanceSquared: 500*500 
}; 

//Game objects
class Entity {
	constructor(position, direction, speed) {
		this.id = Math.random().toString(); 
		this.position = position; 
		this.direction = direction; 
		this.speed = speed; 
	}
	updatePosition() {
		this.position.x += this.speed*Math.cos(this.direction)/fps; 
		this.position.y += this.speed*Math.sin(this.direction)/fps; 
		if (this.position.x < 0) {this.position.x = 0} 
		else if (this.position.x > mapInfo.size.x) {this.position.x = mapInfo.size.x}
		if (this.position.y < 0) {this.position.y = 0} 
		else if (this.position.y > mapInfo.size.y) {this.position.y = mapInfo.size.y}
	}
	update() {
		this.updatePosition(); 
	}
}; 

// Weapons 

class Weapon extends Entity {
	constructor(position, direction, speed, list, owner, timer, attack) {
		super(position, direction, speed); 
		this.resolveIdConflict(list); 
		list[this.id] = this; 
		this.list = list; 
		this.owner = owner; 
		this.timer = timer; 
		this.attack = attack; 
	}
	resolveIdConflict(list) {
		while (this.id in list) {this.id = Math.random().toString(); }
	}
	tick() {
		this.timer = this.timer - 1/fps; 
		if (this.timer <= 0) {
			delete this.list[this.id]; 
		}
	}
	insideSomeShip() {
		for(let shipName in Ship.list) {
			// First check if the ship is near 
			if ((this.position.x - Ship.list[shipName].position.x)*(this.position.x - Ship.list[shipName].position.x) + (this.position.y - Ship.list[shipName].position.y)*(this.position.y - Ship.list[shipName].position.y) < physics.nearDistanceSquared) {
				for (let i = 0; i < Ship.list[shipName].components.length; i++) {
					if (Ship.list[shipName].components[i].isInside(Ship.list[shipName].convertToRelativePos(this.position))) {return true; }
				}
			}
		}
		return false; 
	}
	isDetonating() {} 
	isNear(position){
		if ((this.position.x - position.x)*(this.position.x - position.x) + (this.position.y - position.y)*(this.position.y - position.y) < physics.nearDistanceSquared) {
			return true; 
		}
		return false; 
	}
	detonate() {
		for(let shipName in Ship.list) {
			// First check if the ship is near 
			if (this.isNear(Ship.list[shipName].position)) {
				Ship.list[shipName].tryHit(this.position, this.attack); 
			}
		}
		delete this.list[this.id]; 
	}
	update() {
		this.tick(); 
		this.updatePosition(); 
		if (this.isDetonating()) {
			this.detonate(); 
		}
	} 
	static update() {
		for (let id in this.list) {
			this.list[id].update(); 
		}
	}
} 

class Mine extends Weapon {
	constructor(position, owner) {
		super(position, undefined, undefined, Mine.list, owner, 25, 1); 
		this.activationTimer = 5; 
	} 
	tick() {
		super.tick(); 
		this.activationTimer = Math.max(this.activationTimer - 1/fps, 0); 
	} 
	updatePosition() {} 
	isDetonating() {
		if (this.activationTimer === 0) {
			if (this.insideSomeShip()) {
				return true; 
			}
		}
		return false; 
	} 
}
Mine.list = {}; 

class Torpedo extends Weapon {
	constructor(position, direction, owner) {
		super(position, direction, 1000, Torpedo.list, owner, 10, 2); 
		this.activationTimer = 1; 
	} 
	tick() {
		super.tick(); 
		this.activationTimer = Math.max(this.activationTimer - 1/fps, 0); 
	} 
	isDetonating() {
		if (this.activationTimer === 0) {
			if (this.insideSomeShip()) {
				return true; 
			}
		}
		return false; 
	} 
}
Torpedo.list = {}; 

//Ship modules and components 

class ShipModule {
	constructor(owner, position) {
		this.position = position; 
		this.functional = true; 
		this.owner = owner; 
	}
	update() {}
}

class ShipWeapon extends ShipModule {
	constructor(owner, position, reload) {
		super(owner, position); 
		this.stats = {reload}; 
		this.reloadCountDown = this.stats.reload; 
	}
	tick() {
		if (this.reloadCountDown > 0) {this.reloadCountDown = Math.max(this.reloadCountDown - 1/fps, 0); } 
	}
	update() {
		this.tick(); 
	}
	fire() {
		if (this.reloadCountDown > 0) {
			return false; 
		} 
		else {
			this.reloadCountDown = this.stats.reload; 
			return true; 
		}
	}
}

class Minelayer extends ShipWeapon {
	constructor(owner, position) {
		super(owner, position, 1); 
		this.type = 'minelayer'; 
	}
	fire(info) {
		if (super.fire()) {
			new Mine(Ship.list[this.owner].convertToAbsolutePos(this.position), this.owner); 
		}
	}
}

class TorpedoLauncher extends ShipWeapon {
	constructor(owner, position) {
		super(owner, position, 2); 
		this.type = 'torpedolauncher'; 
		this.multiplicity = 3; 
	}
	fire(info) {
		if (super.fire()) {
			for (let i = -this.multiplicity + 1; i < this.multiplicity; i += 2) {
				new Torpedo(Ship.list[this.owner].convertToAbsolutePos(this.position), mod(Ship.list[this.owner].bearing + info.relativeDirection + info.spread*i/Math.max(this.multiplicity - 1, 1), 2 * Math.PI), this.owner); 
			}
		}
	}
}

class ShipComponent {// Coordinates are relative to the ship, shape coordinates are relative to the element position 
	constructor(position, shape) {
		this.position = position; 
		this.shape = shape; //example: {type: 'polygon', vertices: [{x, y}, ...]} 
		//type polygon is always convex, the vertices are listed in an anti-clockwise order 
		this.modules = []; 
		this.HP = 5; 
	}
	isInside(position) {
		if (this.shape.type === 'polygon') {
			for (let i = 0; i < this.shape.vertices.length; i++) {
				var vectorStart = {x:this.position.x + this.shape.vertices[i].x - position.x, y:this.position.y + this.shape.vertices[i].y - position.y}; 
				var vectorEnd = {x:this.position.x + this.shape.vertices[(i+1)%this.shape.vertices.length].x - position.x, y:this.position.y + this.shape.vertices[(i+1)%this.shape.vertices.length].y - position.y}; 
				if (vectorStart.x*vectorEnd.y-vectorStart.y*vectorEnd.x < 0) {return false; }
			}
		}
		return true; 
	}
	tryHit(position, attack) {
		if (this.isInside(position)) {
			this.HP = Math.max(this.HP - attack, 0); 
			console.log(this.HP); 
		}
	}
	update() {
		for (let i = 0; i < this.modules.length; i++) {
			this.modules[i].update(); 
		}
	}
	fire(data) {
		for (let module in this.modules) {
			if (this.modules[module].type === data.type) {
				this.modules[module].fire(data.info); 
			}
		}
	}
}

class Ship extends Entity {
	constructor(socket) {
		super({x:Math.floor(Math.random()*mapInfo.size.x), y:Math.floor(Math.random()*mapInfo.size.y)}, Math.random()*2*Math.PI, 0); 
		this.name = socket.name; 
		this.socket = socket; 
		this.bearing = this.direction; 
		this.turnCurv = 0; 
		this.stats = {
			maxSpeed: 500, 
			decFactor: 0.2, //the amount of max speed recovered each second without consideration of deceleration 
			rudderShift: 2, 
			rudderRange: 1/500 //1 / turning radius 
		}; 
		this.stats.acc = this.stats.maxSpeed*this.stats.decFactor; //max speed * deceleration factor 
		this.control = {
			rudderLock: false, 
			speedLevels: {
				reverse: -0.25, 
				stop: 0, 
				half: 0.5, 
				full: 1, 
			}, 
			speedLevelCurrent: 'stop', 
		};
		this.components = [new ShipComponent({x:50, y:0}, {type:'polygon', vertices:[{x:-50, y:-50}, {x:50, y:0}, {x:-50, y:50}]}), new ShipComponent({x:-50, y:0}, {type:'polygon', vertices:[{x:-50, y:-50}, {x:50, y:-50}, {x:50, y:50}, {x:-50, y:50}]})]; 
		this.components[1].modules.push(new Minelayer(this.name, {x:-50, y:0})); 
		this.components[1].modules.push(new TorpedoLauncher(this.name, {x:-50, y:0})); 
		this.enemyName = undefined; 
		Ship.list[this.name] = this; 
	}
	updateTurnCurv() {
		if (this.control.rudderLock === 'left'){
			if (!this.control.pressingRight)
			this.turnCurv += this.stats.rudderRange/this.stats.rudderShift/fps; 
			if (this.turnCurv > this.stats.rudderRange)
				this.turnCurv = this.stats.rudderRange; 
		} 
		else if (this.control.rudderLock === 'right'){
			this.turnCurv -= this.stats.rudderRange/this.stats.rudderShift/fps; 
			if (this.turnCurv < -this.stats.rudderRange)
				this.turnCurv = -this.stats.rudderRange; 
		} 
		else {
			this.turnCurv -= Math.sign(this.turnCurv)*this.stats.rudderRange/this.stats.rudderShift/fps; 
			if (Math.abs(this.turnCurv) < this.stats.rudderRange/this.stats.rudderShift/fps) {
				this.turnCurv = 0; 
			}
		}
	}
	updateSpeed() {
		var speedIncrease = this.stats.acc*this.control.speedLevels[this.control.speedLevelCurrent]; 
		speedIncrease -= this.speed*this.stats.decFactor; // Water friction 
		speedIncrease -= this.speed*Math.abs(angleDiffUnderPi(this.bearing, this.direction))*physics.waterFrictionFactor; // Speed lost from turning 
		this.speed += speedIncrease/fps; 
		if (Math.abs(this.speed) < 0.01) {this.speed = 0;}
	} 
	updateDirection() {
		this.bearing += this.speed*this.turnCurv/fps; 
		this.bearing = mod(this.bearing, 2*Math.PI); 
	}
	updateVelocityDirection() {
			this.direction += physics.directionRecoverFactor*angleDiffUnderPi(this.bearing, this.direction); 
			this.direction = mod(this.direction, 2*Math.PI); 
	} 
	update() {
		this.updateTurnCurv(); 
		this.updateSpeed(); 
		this.updatePosition(); 
		this.updateDirection(); 
		this.updateVelocityDirection(); 
		for (let i = 0; i < this.components.length; i++) {
			this.components[i].update(); 
		}
	}
	sendInfoToClient() {
		var detectedShipInfoList = {}; 
		for(let name in Ship.list){
			detectedShipInfoList[name] = {
				position:Ship.list[name].position, 
				bearing:Ship.list[name].bearing, 
				components:Ship.list[name].components
			}; 
		} 
		var detectedMineList = {}; 
		for(let id in Mine.list){
			detectedMineList[id] = {
				position:Mine.list[id].position, 
				activated:(Mine.list[id].activationTimer === 0)
			}; 
		} 
		var detectedTorpedoList = {}; 
		for(let id in Torpedo.list){
			detectedTorpedoList[id] = {
				position:Torpedo.list[id].position, 
				activated:(Torpedo.list[id].activationTimer === 0), 
				direction:Torpedo.list[id].direction
			}; 
		} 
		var msgToSend = {
			detectedShipInfoList, 
			detectedMineList, 
			detectedTorpedoList, 
			myShip:	{
				currentSpeedFrac: this.speed/this.stats.maxSpeed, 
				currentRudderFrac: this.turnCurv/this.stats.rudderRange
			}, 
			enemyShip: {
				name: this.enemyName
			}
		}; 
		this.socket.emit('updateFrame', msgToSend); 
	}
	handleSpeedChange(data) {
		this.control.speedLevelCurrent = data; 
	}
	handleRudderShift(data) {
		this.control.rudderLock = data; 
	} 
	convertToRelativePos(position) {
		return {
			x:Math.cos(this.bearing) * (position.x - this.position.x) + Math.sin(this.bearing) * (position.y - this.position.y), 
			y:- Math.sin(this.bearing) * (position.x - this.position.x) + Math.cos(this.bearing) * (position.y - this.position.y)
		}; 
	}
	convertToAbsolutePos(relativePosition) {
		return {
			x:Math.cos(this.bearing) * (relativePosition.x) - Math.sin(this.bearing) * (relativePosition.y) + this.position.x, 
			y:Math.sin(this.bearing) * (relativePosition.x) + Math.cos(this.bearing) * (relativePosition.y) + this.position.y
		}; 
	}
	tryHit(position, attack) {
		var relativePosition = this.convertToRelativePos(position); 
		for (let i = 0; i < this.components.length; i++) {
			this.components[i].tryHit(relativePosition, attack); 
		} 
	} 
	fire(data) {
		for (let i = 0; i < this.components.length; i++) {
			this.components[i].fire(data); 
		}
	}
	static update() {
		for (let name in Ship.list) {
			Ship.list[name].update(); 
		}
	}
	static sendInfoToClient() {
		for (let name in Ship.list) {
			Ship.list[name].sendInfoToClient(); 
		}
	}
	static addShip(name, socket) {
		Object.defineProperty(socket, 'name', {value:name}); 
		new Ship(socket); 
		console.log('New ship ' + name + ' added'); 
		socket.emit('signUpResponse', {success:true, myShip:{name, position:Ship.list[name].position}, mapInfo}); 
	}
	static removeShip(name) {
		delete Ship.list[name]; 
		for (let shipName in Ship.list) {
			if (Ship.list[shipName].enemyName === name) {
				Ship.list[shipName].enemyName = undefined; 
			}
		}
		console.log('Ship ' + name + ' disconnected and removed'); 
	}
}; 
Ship.list = {}; 

//Connection, handles all packages from and to the client 

var io = require('socket.io')(serv, {}); 
io.sockets.on('connection', socket => {
	
	console.log('New connection'); 
	
	//Sign up, check if name exist, add to SOCKET_LIST 
	socket.on('signUp', data => {
		if (data.name in Ship.list) 
			socket.emit('signUpResponse', {success:false, msg:'name exists, please try another one. '}); 
		else 
			Ship.addShip(data.name, socket); 
	}); 
	
	socket.on('disconnect', () => Ship.removeShip(socket.name)); 
	
	socket.on('speedChange', data => {
		if (socket.name in Ship.list) {
			Ship.list[socket.name].handleSpeedChange(data); 
		}
	}); 
	
	socket.on('rudderShift', data => {
		if (socket.name in Ship.list) {
			Ship.list[socket.name].handleRudderShift(data); 
		}
	}); 
	
	socket.on('selectEnemy', data => {
		if (socket.name in Ship.list) {
			if (data) {
				Ship.list[socket.name].enemyName = data; 
			}
			else {
				Ship.list[socket.name].enemyName = undefined; 
			}
		}
	}); 
	
	socket.on('fireSelectedWeapon', data => {
		if (socket.name in Ship.list) {
			Ship.list[socket.name].fire(data); 
		}
	}); 
}); 


setInterval(function(){
	
	Ship.update(); 
	Mine.update(); 
	Torpedo.update(); 
	Ship.sendInfoToClient(); 

}, 1000/fps);