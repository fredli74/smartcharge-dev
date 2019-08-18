<template>
  <v-flex id="about" xs11 class="xvga-limit mt-12">
    <p>
      After switching to the Swedish energy provider
      <a href="https://tibber.com">tibber.com</a>, I was inspired to create an
      open-source system for charging your EV smarter. By connecting to the
      vehicle API and energy provider API, the system maps your usage and charge
      habits. It then figures out when to best charge your vehicle at off-peak
      hours, which is better for the energy grid and also your wallet if your
      provider has Time-of-Use pricing. Tibber already has this functionality
      for a lot of vehicle brands, but I wanted to create an open-source app
      that I could expand with more features and providers.
    </p>
    <p>
      I have only implemented providers for Tesla and Nordpool since that is
      what I have (Tibber and many other providers use Nordpool spot pricing).
    </p>
    <ul>
      <li>AI that learns your usage and charging habits</li>
      <li>Automatically charge at off-peak hours/days when it's cheaper</li>
      <li>
        Reminds you to connect your charger by automatically opening your charge
        port if you should charge
      </li>
      <li>
        Trip-charging feature that allows you to set a time and needed battery
        level. It will top-up and turn on climate control just before you leave.
      </li>
      <li>
        Turn on your climate control with just a click, without having to wait
        for the car to wake up.
      </li>
      <li>
        It's open-source. Run your server and own your data. In the future, we
        could also have an online public version for convenience.
      </li>
    </ul>
  </v-flex>
</template>

<script lang="ts">
import { Component, Vue } from "vue-property-decorator";

@Component({ components: {} })
export default class About extends Vue {}
</script>

<style>
#about {
  font-size: calc(12px + 1.1vw);
}
</style>
