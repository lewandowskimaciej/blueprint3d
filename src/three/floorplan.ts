import { Floor } from './floor';
import { Edge } from './edge';
import { Ceiling } from './ceiling';
import { RoomLights } from './room_lights';

export var Floorplan = function (scene, floorplan, controls) {
  var scope = this;
  this.scene = scene;
  this.floorplan = floorplan;
  this.controls = controls;
  this.floors = [];
  this.edges = [];
  this.ceilings = [];
  this.roomLights = [];

  floorplan.fireOnUpdatedRooms(redraw);

  function redraw() {
    scope.floors.forEach((floor) => { floor.removeFromScene(); });
    scope.edges.forEach((edge) => { edge.remove(); });
    scope.ceilings.forEach((ceiling) => { ceiling.remove(); });
    scope.roomLights.forEach((rl) => { rl.remove(); });

    scope.floors = [];
    scope.edges = [];
    scope.ceilings = [];
    scope.roomLights = [];

    scope.floorplan.getRooms().forEach((room) => {
      // Floor
      var threeFloor = new (Floor as any)(scene, room);
      scope.floors.push(threeFloor);
      threeFloor.addToScene();

      // Ceiling – THREE.BackSide plane at wall height
      var ceiling = new (Ceiling as any)(scene, room, controls);
      scope.ceilings.push(ceiling);
      ceiling.addToScene();

      // Interior halogen spotlights + fixture meshes
      var roomLights = new (RoomLights as any)(scene, room, controls);
      scope.roomLights.push(roomLights);
    });

    scope.floorplan.wallEdges().forEach((edge) => {
      var threeEdge = new (Edge as any)(scene, edge, scope.controls);
      scope.edges.push(threeEdge);
    });
  }
};
