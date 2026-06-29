<template>
  <n-message-provider>
    <n-dialog-provider>
      <n-notification-provider>
        <n-modal-provider>
          <RouterView />
        </n-modal-provider>
      </n-notification-provider>
    </n-dialog-provider>
  </n-message-provider>
</template>

<script setup>
import { RouterView } from 'vue-router'
</script>

<style></style>
