<template>
  <v-container fluid class="ma-0 pa-0">
    <v-row id="topjumbo" class="px-sm-4">
      <v-col>
        <v-container>
          <v-row
            class="fill-height py-2 py-sm-12"
            align="center"
            justify="center"
            justify-content="space-between"
          >
            <v-col cols="7" sm="3" md="4" lg="5" class="my-4"
              ><v-img
                style="filter: drop-shadow(0 0 1rem #00000066);"
                contain
                src="/img/icons/android-chrome-512x512.png"
              ></v-img
            ></v-col>
            <v-col
              cols="12"
              sm="9"
              md="8"
              lg="7"
              class="white--text mx-4 mx-sm-0"
            >
              <h1 class="font-weight-light text-uppercase mb-4">
                <span>Smart Charge</span>d EV
              </h1>
              <p class="font-weight-light">
                Charge your EV during off-peak hours and save money while load
                balancing the grid.
              </p>
              <v-alert
                v-if="limit"
                id="betaalert"
                class="mt-0 mt-lg-8"
                :color="limit > 0 ? `warning darken-3` : `#cc2200`"
                alt="#2A3B4D"
                dark
                border="left"
                dense
                icon="mdi-bus-stop-uncovered"
                ><div>
                  Smart Charge is currently in beta with a limited number of
                  vehicle spots.
                </div>
                <div class="mt-4 font-weight-bold">
                  {{ limit > 0 ? limit : "No" }} spot{{ limit > 1 ? "s" : "" }}
                  available
                </div>
              </v-alert>
            </v-col>
          </v-row>
        </v-container>
      </v-col>
    </v-row>

    <v-row style="background:#ddd" class="px-sm-12">
      <v-col>
        <v-container>
          <v-row id="about" class="xvga-limit autosize flex-nowrap"
            ><v-col>
              <h1>About</h1>
              <p>
                After switching to the Swedish energy provider
                <a href="https://tibber.com">tibber.com</a>&nbsp;
                <small>
                  <a href="https://invite.tibber.com/97b3d1fc"
                    >(use bonus code 97b3d1fc)</a
                  ></small
                >
                that utilizes time-of-use pricing, I was inspired to create an
                open-source system for charging my Tesla smarter. By connecting
                to the Tesla API, it controls the charging to low-price hours,
                which is typically when energy production is higher than the
                power grid demand. This not only helps you cut cost (if you have
                time-of-use pricing), but it also helps in balancing the power
                grid.
              </p>
              <p>
                The system is still under development and currently only works
                with Tesla vehicles and Swedish electricity spot prices. But it
                could eventually be expanded with more vehicle providers and
                international price lists.
              </p>
            </v-col></v-row
          >
        </v-container>
      </v-col>
    </v-row>

    <v-row
      ><v-col>
        <v-container>
          <v-row>
            <v-col v-for="(feature, i) in features" :key="i" cols="12" md="6">
              <v-card class="pt-2" flat>
                <v-row>
                  <v-col cols="auto">
                    <v-avatar
                      color="grey lighten-4"
                      class="elevation-2"
                      size="80"
                    >
                      <v-avatar color="white" size="66" class=""
                        ><v-icon large>{{ feature.icon }}</v-icon></v-avatar
                      ></v-avatar
                    ></v-col
                  >
                  <v-col>
                    <v-card-title class="py-0 headline">{{
                      feature.title
                    }}</v-card-title
                    ><v-card-text class="mt-1 body-1	"
                      >{{ feature.text }}
                    </v-card-text>
                  </v-col></v-row
                >
              </v-card>
            </v-col>
          </v-row>
        </v-container>
      </v-col>
    </v-row>
    <v-row style="background:#000" class="px-3 px-sm-12 white--text">
      <v-container id="about-footer">
        <v-row align="start" justify-content="space-between">
          <v-col cols="12" md="6" class="">
            <h2>
              Open-source
            </h2>
            <p>
              Since the system handles Tesla API access keys, I believe in full
              transparency. Audit the code or run your server and own your data.
            </p>
          </v-col>
          <v-col cols="12" md="6" class="">
            <h2><v-icon x-large color="white">mdi-github</v-icon></h2>

            <a
              class="white--text"
              href="https://github.com/fredli74/smartcharge-dev"
              >https://github.com/fredli74/smartcharge-dev</a
            >
            <div>This project is open-sourced under the MIT License.</div>
            <div>&copy;{{ new Date().getFullYear() }} by Fredrik Lidström</div>
          </v-col>
        </v-row></v-container
      ></v-row
    ></v-container
  >
</template>

<script lang="ts">
import { Component, Vue } from "vue-property-decorator";
import apollo from "@app/plugins/apollo";

@Component({ components: {} })
export default class About extends Vue {
  limit!: number;
  async mounted() {
    const limit = await apollo.getVehicleLimit();
    this.limit = limit === null ? 0 : limit || -1;
  }
  data() {
    return {
      limit: undefined,
      features: [
        {
          title: "AI driven charging",
          icon: "mdi-school-outline",
          text: `Maps usage and charging habits to figure out the needed battery level and charging window.`
        },
        {
          title: "Off-peak hours and days",
          icon: "mdi-weather-night-partly-cloudy",
          text: `Smart Charge tries to find the best price to charge, whether it is a windy day or weekend with low demand.`
        },
        {
          title: "Schedule trips",
          icon: "mdi-road",
          text: `Allows you to set a time and needed battery level. It will top-up and turn on climate control just before you leave.`
        },
        {
          title: "Doctor sleep",
          icon: "mdi-sleep",
          text: `See if your vehicle is sleeping as it should. Vampire drain causes lost range and unnecessary battery usage.`
        },
        {
          title: "Reminds you to connect",
          icon: "mdi-power-plug-outline",
          text: `Automatically openens your charge port, if a charge is planned (optional feature).`
        },
        {
          title: "Climate on",
          icon: "mdi-snowflake",
          text: `Turn on your climate control with just a click, without having to wait for the car to wake up.`
        }
      ]
    };
  }
}
</script>

<style lang="scss">
@import "~vuetify/src/styles/settings/_variables";

#topjumbo {
  h1 {
    font-size: 3.75rem;
  }
  p {
    font-size: 1.5rem;
    max-width: 36rem;
  }
  #betaalert {
    max-width: 36rem;
  }
  @media #{map-get($display-breakpoints, 'sm-and-down')} {
    h1 {
      font-size: 6vw;
    }
    p {
      font-size: 2.5vw;
      max-width: 60vw;
    }
    #betaalert {
      max-width: 60vw;
    }
  }
  @media #{map-get($display-breakpoints, 'xs-only')} {
    h1 {
      font-size: 9vw;
      text-align: center;
    }
    p {
      font-size: 4.4vw;
      text-align: center;
      max-width: 100%;
    }
    #betaalert {
      max-width: 100%;
    }
  }
}

.page-about {
  #app-bar {
    background: #0e0e0e !important;
  }
  #app-content {
    margin-bottom: 0 !important;
    padding-bottom: 0 !important;
  }
}
#topjumbo {
  background: #000;
  background: linear-gradient(0, #061f1f 0%, #10191f 100%);

  h1 {
    color: #a58954;
  }
  h1 span {
    color: #ffc459;
  }
}
#about {
  font-size: calc(12px + 0.8vw);
}
@media #{map-get($display-breakpoints, 'sm-and-down')} {
  #about-footer {
    text-align: center;
  }
}
</style>
