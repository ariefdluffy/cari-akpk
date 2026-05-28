/// <reference types="@sveltejs/kit" />

declare global {
	namespace App {
		interface Locals {
			// Add locals here
		}
		interface PageData {}
		interface Platform {}
	}
}

export {};
