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
	directionRecoverFactor:1-Math.pow((1-0.9),1/fps) // 1-(1-<percentage of angle recovered per second>)^(1/fps)
}; 

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

//Ship 

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
			decFactor: 0.1, //the amount of max speed recovered each second without consideration of deceleration 
			rudderShift: 2, 
			rudderRange: 1/500 //1 / turning radius 
		}; 
		this.stats.acc = 500*this.stats.decFactor; //max speed * deceleration factor 
		this.control = {
			pressingLeft: false, 
			pressingRight: false, 
			pressingAcc: false, 
			pressingReverse: false
		};
		Ship.list[this.name] = this; 
	}
	updateTurnCurv() {
		if (this.control.pressingLeft){
			if (!this.control.pressingRight)
			this.turnCurv += this.stats.rudderRange/this.stats.rudderShift/fps; 
			if (this.turnCurv > this.stats.rudderRange)
				this.turnCurv = this.stats.rudderRange; 
		} 
		else if (this.control.pressingRight){
			this.turnCurv -= this.stats.rudderRange/this.stats.rudderShift/fps; 
			if (this.turnCurv < -this.stats.rudderRange)
				this.turnCurv = -this.stats.rudderRange; 
		} 
		else {
			this.turnCurv -= Math.sign(this.turnCurv)*this.stats.rudderRange/this.stats.rudderShift/fps; 
		}
	}
	updateSpeed() {
		var speedIncrease = 0; 
		if (this.control.pressingAcc){
			speedIncrease += this.stats.acc; 
		} else if (this.speed > 0 || this.control.pressingReverse){
			speedIncrease -= this.stats.acc/4; 
		}
		speedIncrease -= this.speed*this.stats.decFactor; // Water friction 
		speedIncrease -= this.speed*Math.abs(angleDiffUnderPi(this.bearing, this.direction)); // Speed lost from turning 
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
			detectedShipInfoList[name] = {position:{x:Ship.list[name].x, y:Ship.list[name].y}, bearing:Ship.list[name].bearing}; 
		}
		this.socket.emit('updateFrame', {detectedShipInfoList}); 
	}
	handleKeyInput(inputId, state) {
		if ('pressing' + inputId in this.control)
			this.control['pressing' + inputId] = state; 
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
	
	socket.on('keyPress', data => {
		if (socket.name in Ship.list) 
			Ship.list[socket.name].handleKeyInput(data.inputId, data.state); 
	}); 
}); 


setInterval(function(){
	
	Ship.update(); // Handles updating ship status and emits packages to client 

}, 1000/fps);