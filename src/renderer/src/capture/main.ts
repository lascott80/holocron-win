// The quick capture window's page (capture.html): the second renderer entry.
import "@fontsource-variable/jetbrains-mono";
import "@fontsource-variable/jetbrains-mono/wght-italic.css";
import "../app.css";
import { mount } from "svelte";
import Capture from "./Capture.svelte";

mount(Capture, { target: document.getElementById("app")! });
