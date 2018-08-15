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
	waterFrictionFactor:20/fps // <fraction of speed lost per second per angular difference of bearing and velocity direction>/fps 
}; 

//Game objects
class Entity {
	constructor() {
		this.id = Math.random().toString(); 
		this.x = 0; 
		this.y = 0; 
		this.direction = 0; 
		this.speed = 0; 
	}
	updatePosition() {
		this.x += this.speed*Math.cos(this.direction)/fps; 
		this.y += this.speed*Math.sin(this.direction)/fps; 
		if (this.x < 0) {this.x = 0} 
		else if (this.x > mapInfo.size.x) {this.x = mapInfo.size.x}
		if (this.y < 0) {this.y = 0} 
		else if (this.y > mapInfo.size.y) {this.y = mapInfo.size.y}
	}
	update() {
		this.updatePosition(); 
	}
}; 

//Ship elements 
class ShipElement {// Coordinates are relative to the ship, shape coordinates are relative to the element position 
	constructor(position, shape) {
		this.position = position; 
		this.shape = shape; //example: {type: 'polygon', vertices: [{x, y}, ...]} 
		//type polygon is always convex, the vertices are listed in an anti-clockwise order 
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
}

class ShipComponent extends ShipElement {
	constructor(position, shape) {
		super(position, shape); 
		this.modules = []; 
		this.HP = 5; 
	}
	hit(position) {
		if (this.isInside(position)) {
			this.HP = Math.max(this.HP - 1, 0); 
		}
	}
}

class Ship extends Entity {
	constructor(socket) {
		super(); 
		this.name = socket.name; 
		this.socket = socket; 
		this.x = Math.floor(Math.random()*mapInfo.size.x); 
		this.y = Math.floor(Math.random()*mapInfo.size.y); 
		this.bearing = Math.random()*2*Math.PI; 
		this.direction = this.bearing; 
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
	}
	sendInfoToClient() {
		var detectedShipInfoList = {}; 
		for(let name in Ship.list){
			detectedShipInfoList[name] = {
				position:{
					x:Ship.list[name].x, 
					y:Ship.list[name].y
				}, 
				bearing:Ship.list[name].bearing, 
				components:Ship.list[name].components
			}; 
		}
		var msgToSend = {
			detectedShipInfoList, 
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
	static update() {
		for (let name in Ship.list) {
			Ship.list[name].update(); 
		}
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
		Ship.list[socket.name].enemyName = data; 
	}); 
}); 


setInterval(function(){
	
	Ship.update(); // Handles updating ship status and emits packages to client 

}, 1000/fps);