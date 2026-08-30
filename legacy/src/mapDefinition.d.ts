export type ScenicSpot = {
	"displayName": string,
	"floorIndex": number,
	"position": [number, number, number],
	"description"?: string
};

export type mapDefinition = {
	"name": string,
	"floorElevationByIndex": {
		[k: `${number}`]: number
	},
	"pointsOfInterest": {
		[spotId: string]: ScenicSpot
	}
};
