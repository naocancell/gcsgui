<template>
    <div
        class="avionics-panel"
        :style="panelStyle"
         @mousedown="startDrag"
    >
        <!-- Header -->
        <div
            class="panel-header"
        >

            <div class="title">
                ✈ UAV AVIONICS
                <span class="sub-title">
                    无人机航电
                </span>
            </div>


            <div
                class="status"
                :class="{
                    online:
                    telemetryStore.connected &&
                    !telemetryStore.stale,

                    offline:
                    !telemetryStore.connected ||
                    telemetryStore.stale
                }"
            >

                <span class="status-dot"></span>

                {{
                    telemetryStore.stale
                    ? 'TIMEOUT'
                    : 'ONLINE'
                }}

            </div>

        </div>
        <!-- Telemetry -->
        <div
            v-if="telemetry"
            class="panel-body"
        >


            <!-- Status -->
            <section>

                <div class="section-title">
                    STATUS / 状态
                </div>


                <div class="grid">

                    <div class="card">

                        <label>
                            MODE 飞行模式
                        </label>

                        <strong>
                            {{ telemetry.flightMode }}
                        </strong>

                    </div>


                    <div class="card">

                        <label>
                            ARM 解锁
                        </label>

                        <strong>
                            {{
                                telemetry.armed
                                ? 'ARMED'
                                : 'SAFE'
                            }}
                        </strong>

                    </div>

                </div>

            </section>



            <!-- Position -->
            <section>

                <div class="section-title">
                    POSITION / 位置
                </div>


                <div class="row">

                    <span>
                        LAT 纬度
                    </span>

                    <strong>
                        {{
                            telemetry.latitude.toFixed(6)
                        }}
                    </strong>

                </div>


                <div class="row">

                    <span>
                        LON 经度
                    </span>

                    <strong>
                        {{
                            telemetry.longitude.toFixed(6)
                        }}
                    </strong>

                </div>


                <div class="row">

                    <span>
                        ALT 高度
                    </span>

                    <strong class="highlight">

                        {{
                            telemetry.altitude.toFixed(1)
                        }}
                        m

                    </strong>

                </div>

            </section>



            <!-- Attitude -->
            <section>

                <div class="section-title">
                    ATTITUDE / 姿态
                </div>


                <div class="grid">


                    <div class="card">

                        <label>
                            HDG 航向
                        </label>

                        <strong>
                            {{
                                telemetry.heading.toFixed(1)
                            }}°
                        </strong>

                    </div>


                    <div class="card">

                        <label>
                            PITCH 俯仰
                        </label>

                        <strong>
                            {{
                                telemetry.pitch.toFixed(1)
                            }}°
                        </strong>

                    </div>


                    <div class="card">

                        <label>
                            ROLL 横滚
                        </label>

                        <strong>
                            {{
                                telemetry.roll.toFixed(1)
                            }}°
                        </strong>

                    </div>


                    <div class="card">

                        <label>
                            GS 地速
                        </label>

                        <strong>

                            {{
                                telemetry.groundSpeed.toFixed(1)
                            }}
                            m/s

                        </strong>

                    </div>


                </div>


            </section>



            <!-- System -->
            <section>

                <div class="section-title">
                    SYSTEM / 系统
                </div>


                <div class="row">

                    <span>
                        BATTERY 电量
                    </span>


                    <strong
                        :class="{
                            danger:
                            telemetry.battery < 20
                        }"
                    >

                        {{
                            telemetry.battery.toFixed(0)
                        }}%

                    </strong>

                </div>



                <div class="row">

                    <span>
                        GPS 星数
                    </span>

                    <strong>
                        {{
                            telemetry.gpsSatellites
                        }}
                        SAT
                    </strong>

                </div>


                <div class="row">

                    <span>
                        VSPD 垂直速度
                    </span>

                    <strong>

                        {{
                            telemetry.verticalSpeed.toFixed(1)
                        }}
                        m/s

                    </strong>

                </div>


            </section>


        </div>
        <!-- Empty -->
        <div
            v-else
            class="empty"
        >

            WAITING TELEMETRY DATA...

            <br>

            等待航电数据

        </div>
        <!-- Warning -->
        <div
            v-if="telemetryStore.stale"
            class="warning"
        >
            ⚠ TELEMETRY LOST / 数据超时
        </div>
    </div>
</template>

<script setup lang="ts">

import {
    computed,
    ref,
    onBeforeUnmount
} from 'vue'

import {
    useTelemetryStore
} from '@/store/useTelemetryStore'

const telemetryStore =
    useTelemetryStore()
const telemetry =
    computed(() => {
        return telemetryStore.telemetry
    })

// Panel Drag
// 面板初始位置
const panelPosition = ref({
    x:16,
    y:56
})

const panelStyle = computed(() => {

    return {
        left:
        panelPosition.value.x + 'px',

        top:
        panelPosition.value.y + 'px'
    }
})

let dragging = false
let startX = 0
let startY = 0
let originX = 0
let originY = 0
function startDrag(
    e: MouseEvent
){
    // 只允许左键
    if(e.button !== 0){
        return
    }
    dragging = true
    startX = e.clientX
    startY = e.clientY
    originX =
        panelPosition.value.x
    originY =
        panelPosition.value.y
    window.addEventListener(
        'mousemove',
        onDrag
    )
    window.addEventListener(
        'mouseup',
        stopDrag
    )
    // 防止浏览器默认拖拽
    e.preventDefault()
}
function onDrag(
    e: MouseEvent
){
    if(!dragging){
        return
    }
    // 鼠标左键没有按下
    // 立即停止
    if(e.buttons !== 1){
        stopDrag()
        return
    }
    let x =
        originX +
        e.clientX -
        startX
    let y =
        originY +
        e.clientY -
        startY
    // 限制边界
    x = Math.max(
        0,
        Math.min(
            window.innerWidth - 330,
            x
        )
    )
    y = Math.max(
        0,
        Math.min(
            window.innerHeight - 200,
            y
        )
    )
    panelPosition.value.x = x
    panelPosition.value.y = y
}

function stopDrag(){
    dragging = false
    window.removeEventListener(
        'mousemove',
        onDrag
    )

    window.removeEventListener(
        'mouseup',
        stopDrag
    )
}

onBeforeUnmount(()=>{
    stopDrag()
})
</script>
<style scoped>

.avionics-panel{
    position:fixed;
    width:320px;
    padding:14px;
    background:
    rgba(8,18,35,.88);
    color:white;
    border:
    1px solid rgba(0,210,255,.35);
    border-radius:10px;
    backdrop-filter:blur(10px);
    box-shadow:
    0 0 25px rgba(0,180,255,.25);
    font-size:13px;
    font-family:
    Consolas,
    Microsoft YaHei,
    sans-serif;
}

.panel-header{
    display:flex;
    justify-content:space-between;
    align-items:center;
    cursor:move;
    user-select:none;
    padding-bottom:10px;
    border-bottom:
    1px solid rgba(255,255,255,.12);
}

.title{
    font-size:15px;
    font-weight:700;
}

.sub-title{
    margin-left:6px;
    color:
    rgba(255,255,255,.55);
}

.status{
    display:flex;
    align-items:center;
    gap:6px;
}

.status-dot{
    width:8px;
    height:8px;
    border-radius:50%;
}



.online .status-dot{
    background:#00ff99;
}
.offline .status-dot{
  background:#ff4d4f;
}

section{
    margin-top:14px;
}

.section-title{
    color:#00d9ff;
    font-size:11px;
    margin-bottom:8px;
}

.grid{
    display:grid;
    grid-template-columns:repeat(2,1fr);
    gap:8px;
}
.card{
    padding:8px;
    background:
    rgba(255,255,255,.05);
    border-radius:6px;
}

.card label{
    display:block;
    font-size:10px;
    color:
    rgba(255,255,255,.55);
}

.row{
    display:flex;
    justify-content:space-between;
    padding:5px 0;
}
.highlight{
    color:#00ffcc;
}

.danger{
    color:#ff4d4f;
}

.warning{
    margin-top:12px;
    padding:8px;
    color:#ffd666;
    background:
    rgba(255,180,0,.15);
    border-radius:6px;
}

.empty{
    padding:20px;
    text-align:center;
}

</style>