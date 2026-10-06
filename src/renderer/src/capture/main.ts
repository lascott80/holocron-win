// The quick capture window's page (capture.html): the second renderer entry.
import "../app.css";
import { mount } from "svelte";
import Capture from "./Capture.svelte";

mount(Capture, { target: document.getElementById("app")! });
