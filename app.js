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
	nearDistanceSquared: 500*500, 
	getMaximumSpeed: function(i) {return [0, 350, 400, 460, 520, 600, 650][i]}, 
	getDecFactor: function(i) {return [0.1, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35][i]}, 
	getSize: i => [75, 90, 110, 130, 150][i], 
	getDefense: i => [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8][i], 
	getAttackCaliber: i => [0.3, 0.36, 0.43, 0.51, 0.6][i], 
	getAttackExplosive: i => [0.6, 0.7, 0.85, 1, 1.2][i]
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
	} // tick the timer, delete if timeout 
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
	constructor(position, owner, attack) {
		super(position, undefined, undefined, Mine.list, owner, 25, attack); 
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
	detonate() {
		super.detonate(); 
		delete this.list[this.id]; 
	}
}
Mine.list = {}; 

class Torpedo extends Weapon {
	constructor(position, direction, owner, attack) {
		super(position, direction, 700, Torpedo.list, owner, 10, attack); 
		this.activationTimer = 0.5; 
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
	detonate() {
		super.detonate(); 
		delete this.list[this.id]; 
	}
}
Torpedo.list = {}; 

class Shell extends Weapon {
	constructor(position, owner, destination, attack) {
		super(position, undefined, 10000, Shell.list, owner, 0, attack); 
		this.destination = destination; 
		this.activated = true; 
	} 
	tick() {
		this.timer = this.timer - 1/fps; 
		if (this.timer <= -3) {
			delete this.list[this.id]; 
		} 
	} 
	updatePosition() {
		if (this.timer <= 0) {
			this.position = this.destination; 
		} 
		else {
			this.position.x += this.speed*Math.cos(this.direction)/fps; 
			this.position.y += this.speed*Math.sin(this.direction)/fps; 
		}
	}
	update() {
		this.tick(); 
		this.updatePosition(); 
		if (this.timer <= 0 && this.activated) {
			this.detonate(); 
			this.activated = false; 
		}
	} 
}
Shell.list = {}; 

//Ship modules and components 

class ShipModule {
	constructor(owner, position, componentId, isDominant, onlyOnePerShip) {
		this.position = position; 
		this.functional = true; 
		this.owner = owner; 
		this.componentId = componentId; 
		this.isDominant = isDominant; 
		this.onlyOnePerShip = onlyOnePerShip; 
	}
	update() {}
}

class Engine extends ShipModule{
	constructor(owner, position, componentId) {
		super(owner, position, componentId, false, false); 
		this.type = 'engine'; 
		Ship.list[this.owner].updateSpeedInfo(true); 
	}
}

class ShipWeapon extends ShipModule {
	constructor(owner, position, componentId, reload, isDominant, onlyOnePerShip) {
		super(owner, position, componentId, isDominant, onlyOnePerShip); 
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
		if (this.reloadCountDown > 0 || !this.functional) {
			return false; 
		} 
		else {
			this.reloadCountDown = this.stats.reload; 
			return true; 
		}
	}
}

class Minelayer extends ShipWeapon {
	constructor(owner, position, componentId) {
		super(owner, position, componentId, 5, true, true); 
		this.type = 'minelayer'; 
	}
	fire(info) {
		if (super.fire()) {
			new Mine(Ship.list[this.owner].convertToAbsolutePos(this.position), this.owner, physics.getAttackExplosive(Ship.list[this.owner].levels.explosive)); 
		}
	}
}

class TorpedoLauncher extends ShipWeapon {
	constructor(owner, position, componentId) {
		super(owner, position, componentId, 5, true, false); 
		this.type = 'torpedolauncher'; 
	}
	fire(info) {
		if (info.componentId === this.componentId) {
		if (super.fire()) {
			for (let i = (-Ship.list[this.owner].levels.torpmult + 1)/2; i < Ship.list[this.owner].levels.torpmult/2; i++) {
				new Torpedo(Ship.list[this.owner].convertToAbsolutePos(this.position), mod(Ship.list[this.owner].bearing + info.relativeDirection + info.spread*i, 2 * Math.PI), this.owner, physics.getAttackExplosive(Ship.list[this.owner].levels.explosive)); 
			}
		}
		}
	}
}

class Gun extends ShipWeapon {
	constructor(owner, position, componentId) {
		super(owner, position, componentId, 2, true, false); 
		this.type = 'gun'; 
	}
	fire(info) {
		if (super.fire()) {
			for (let i = 0; i < Ship.list[this.owner].levels.gunmult; i++) {
				var diviation = 0.1; 
				var distance = Math.sqrt((info.x - Ship.list[this.owner].position.x)*(info.x - Ship.list[this.owner].position.x) + (info.y - Ship.list[this.owner].position.y)*(info.y - Ship.list[this.owner].position.y)); 
				var destination = {
					x: info.x + (Math.random()*diviation - diviation/2)*distance, 
					y: info.y + (Math.random()*diviation - diviation/2)*distance
				}; 
				new Shell(Ship.list[this.owner].convertToAbsolutePos(this.position), this.owner, destination, physics.getAttackCaliber(Ship.list[this.owner].levels.caliber)); 
			}
		}
	}
}

var modules = {
	'minelayer': Minelayer, 
	'torpedolauncher': TorpedoLauncher, 
	'gun': Gun, 
	'engine': Engine
}; 

class ShipComponent {// Coordinates are relative to the ship, shape coordinates are relative to the element position 
	constructor(position, shape, owner) {
		this.position = position; 
		this.shape = shape; //example: {type: 'polygon', vertices: [{x, y}, ...]} 
		//type polygon is always convex, the vertices are listed in an anti-clockwise order 
		this.modules = []; 
		this.HP = 1; 
		this.dominantModule = undefined; 
		this.owner = owner; 
		this.functional = true; 
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
		if (this.isInside(position) && this.functional) {
			this.HP = Math.max(this.HP - Math.max(Math.random()*attack - Math.random()*physics.getDefense(Ship.list[this.owner].levels.size+Ship.list[this.owner].levels.armor), 0), 0); 
			if (this.HP === 0) {
				this.functional = false; 
				this.modules.map(module => {module.functional = false; }); 
				Ship.list[this.owner].updateSpeedInfo(); 
			}
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
		this.aimDirection = 0; 
		this.levels = {
			levelPoints: 17, 
			concealment: 0, 
			detection: 0, 
			armor: 0, 
			size: 0, 
			caliber: 0, 
			explosive: 0, 
			gunmult: 1, 
			torpmult: 1, 
			ruddershift: 0, 
			superstructure: 0
		}; 
		this.levelUp = {
			size: function() {
				if (this.levels.size < 4 && this.levels.levelPoints > 0) {
					this.levels.size += 1; 
					this.levels.levelPoints -= 1; 
					this.size = physics.getSize(this.levels.size); 
					for (let i = 0; i < this.components.length; i++) {
						this.components[i].position.x *= physics.getSize(this.levels.size)/physics.getSize(this.levels.size-1); 
						for (let j = 0; j < this.components[i].shape.vertices.length; j++) {
							this.components[i].shape.vertices[j].x *= physics.getSize(this.levels.size)/physics.getSize(this.levels.size-1); 
							this.components[i].shape.vertices[j].y *= physics.getSize(this.levels.size)/physics.getSize(this.levels.size-1); 
						}
					}
				} 
			}, 
			gunmult: function() {
				if (this.levels.gunmult < 4 && this.levels.levelPoints > 1) {
					this.levels.gunmult += 1; 
					this.levels.levelPoints -= 2; 
				} 
			}, 
			torpmult: function() {
				if (this.levels.torpmult < 5 && this.levels.levelPoints > 1) {
					this.levels.torpmult += 1; 
					this.levels.levelPoints -= 2; 
				} 
			}, 
			armor: function() {
				if (this.levels.armor < 4 && this.levels.levelPoints > 0) {
					this.levels.armor += 1; 
					this.levels.levelPoints -= 1; 
				} 
			}, 
			caliber: function() {
				if (this.levels.caliber < this.levels.size && this.levels.levelPoints > 0) {
					this.levels.caliber += 1; 
					this.levels.levelPoints -= 1; 
				} 
			}, 
			explosive: function() {
				if (this.levels.explosive < 4 && this.levels.levelPoints > 0) {
					this.levels.explosive += 1; 
					this.levels.levelPoints -= 1; 
				} 
			}
		}; 
		for (let key in this.levelUp) {
			this.levelUp[key] = this.levelUp[key].bind(this); 
		}; 
		this.stats = {
			maxSpeed: undefined, 
			decFactor: undefined, //the amount of max speed recovered each second without consideration of deceleration 
			acc: undefined, 
			rudderShift: 2, 
			rudderRange: 1/500 //1 / turning radius 
		}; 
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
		this.size = 75; 
		this.components = [
			new ShipComponent({x:this.size/2, y:0}, {type:'polygon', vertices:[{x:-this.size/2, y:-this.size/2}, {x:this.size/2, y:-this.size/4}, {x:this.size, y:0}, {x:this.size/2, y:this.size/4}, {x:-this.size/2, y:this.size/2}]}, this.name), 
			new ShipComponent({x:-this.size/2, y:0}, {type:'polygon', vertices:[{x:-this.size/2, y:-this.size/4}, {x:-this.size/4, y:-this.size/2}, {x:this.size/2, y:-this.size/2}, {x:this.size/2, y:this.size/2}, {x:-this.size/4, y:this.size/2}, {x:-this.size/2, y:this.size/4}]}, this.name)
		]; 
		this.enemyName = undefined; 
		this.modules = {
			gun: [], 
			torpedolauncher: [], 
			minelayer: undefined, 
			rudder: undefined, 
			engine: [], 
			repair: []
		}; 
		Ship.list[this.name] = this; 
		this.addModule(1, 'engine'); 
	}
	updateSpeedInfo(engineCreatedButNotYetAdded = false) {
		var numberOfFunctioningEngines = 0; 
		this.modules.engine.map(engine => {if (engine.functional) {numberOfFunctioningEngines++}}); 
		if (engineCreatedButNotYetAdded) {
			numberOfFunctioningEngines++; 
		}
		this.stats.maxSpeed = physics.getMaximumSpeed(numberOfFunctioningEngines); 
		this.stats.decFactor = physics.getDecFactor(numberOfFunctioningEngines); 
		this.stats.acc = this.stats.maxSpeed*this.stats.decFactor; 
	}
	addComponent(i) {// insert at the i'th component 
		if (this.components.length >= 6 || i === 0 || i > this.components.length) {
			return; 
		}
		this.levels.levelPoints -= 1; 
		this.components.splice(i, 0, new ShipComponent({x:(this.components.length/2 - i)*this.size, y:0}, {type:'polygon', vertices:[{x:-this.size/2, y:-this.size/2}, {x:this.size/2, y:-this.size/2}, {x:this.size/2, y:this.size/2}, {x:-this.size/2, y:this.size/2}]}, this.name)); 
		for (let j = 0; j < i; j++) {
			this.components[j].position.x += this.size/2; 
		}
		for (let j = i + 1; j < this.components.length; j++) {
			this.components[j].position.x -= this.size/2; 
			for (let k = 0; k < this.components[j].modules.length; k++) {
				this.components[j].modules[k].componentId += 1; 
			}
		}
	}
	addModule(componentId, moduleType) {
		if (moduleType === 'component') {
			return this.addComponent(componentId); 
		}
		var newModule = new modules[moduleType](this.name, this.components[componentId].position, componentId); 
		if (newModule.onlyOnePerShip && this.modules[moduleType] !== undefined) {
			return; 
		}
		if (newModule.isDominant) {
			if (this.components[componentId].dominantModule !== undefined) {
				return; 
			}
			else {
				this.components[componentId].dominantModule = newModule; 
			}
		}
		this.components[componentId].modules.push(newModule); 
		this.levels.levelPoints -= 1; 
		if (newModule.onlyOnePerShip) {
			this.modules[moduleType] = newModule; 
		}
		else {
			this.modules[moduleType].push(newModule); 
		}
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
				components:Ship.list[name].components, 
				size:Ship.list[name].size, 
				levels:Ship.list[name].levels, 
				aimDirection:Ship.list[name].aimDirection
			}; 
		} 
		var detectedMineList = {}; 
		for(let id in Mine.list){
			detectedMineList[id] = {
				position:Mine.list[id].position, 
				activationTimer:Mine.list[id].activationTimer
			}; 
		} 
		var detectedTorpedoList = {}; 
		for(let id in Torpedo.list){
			detectedTorpedoList[id] = {
				position:Torpedo.list[id].position, 
				activationTimer:Torpedo.list[id].activationTimer, 
				direction:Torpedo.list[id].direction
			}; 
		} 
		var detectedShellList = {}; 
		for(let id in Shell.list){
			detectedShellList[id] = {
				position:Shell.list[id].position, 
				activationTimer:Shell.list[id].timer
			}; 
		} 
		var msgToSend = {
			detectedShipInfoList, 
			detectedMineList, 
			detectedTorpedoList, 
			detectedShellList, 
			myShip:	{
				currentSpeedFrac: this.speed/this.stats.maxSpeed, 
				currentRudderFrac: this.turnCurv/this.stats.rudderRange, 
				levels: this.levels
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
		socket.emit('signUpResponse', {success:true, myShip:{name, position:Ship.list[name].position, components: Ship.list[name].components}, mapInfo}); 
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
	
	socket.on('upgrade', data => {
		if (socket.name in Ship.list) {
			Ship.list[socket.name].levelUp[data](); 
		}
	}); 
	
	socket.on('addModule', data => {
		if (socket.name in Ship.list) {
			Ship.list[socket.name].addModule(data.componentId, data.moduleName); 
		}
	}); 
	
	socket.on('aimDirection', data => {
		if (socket.name in Ship.list) {
			Ship.list[socket.name].aimDirection = data; 
		}
	}); 
}); 

setInterval(function(){
	
	Shell.update(); 
	Ship.update(); 
	Mine.update(); 
	Torpedo.update(); 
	Ship.sendInfoToClient(); 

}, 1000/fps);