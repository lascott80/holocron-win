import "@fontsource-variable/jetbrains-mono";
import "@fontsource-variable/jetbrains-mono/wght-italic.css";
import "./app.css";
import "@editor/editor.css";
import { mount } from "svelte";
import App from "./App.svelte";
import { app } from "./lib/app.svelte";

app.start();
mount(App, { target: document.getElementById("app")! });
